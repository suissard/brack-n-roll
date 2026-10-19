import type {
  BlockConfigBase,
  BlockState,
  EnrichedTeam,
  Match,
  ParticipantSlot,
  PointsConfig,
} from '../types/domain.types';
import type { SerializedBlockState } from '../types/events.types';
import type { TournamentRegistry } from '../core/registry';
import type { DeterministicPRNG } from '../utils/prng';

export type BlockType = 'BRACKET' | 'SWISS' | 'ROUND_ROBIN' | 'MERGER';

/**
 * Machine à états commune à tous les blocs du DAG.
 *
 * Cycle de vie : PENDING -> SEEDING_AND_PAIRING -> IN_PROGRESS -> RESOLVING
 * -> COMPLETED (ou SKIPPED par court-circuit conditionnel).
 */
export abstract class AbstractTournamentBlock {
  readonly id: string;
  readonly config: BlockConfigBase;

  protected state: BlockState = 'PENDING';
  protected inputTeamIds: string[] = [];
  protected outputTeamIds: string[] = [];
  protected matches: Match[] = [];
  protected pairingsLocked = false;
  protected lockedPairs?: Array<[string, string | 'BYE']>;
  protected receivedConnectors: Set<string> = new Set();

  constructor(config: BlockConfigBase) {
    this.id = config.id;
    this.config = config;
  }

  abstract get blockType(): BlockType;

  abstract generateMatches(
    registry: TournamentRegistry,
    prng: DeterministicPRNG,
    pointsConfig: PointsConfig,
  ): void;

  abstract serializeConfig(): Record<string, unknown>;

  /** Calcule `outputTeamIds` à la fin du bloc. */
  protected abstract computeOutputs(registry: TournamentRegistry): string[];

  // ---------------------------------------------------------------------------
  // Accesseurs (lecture seule pour l'extérieur)
  // ---------------------------------------------------------------------------

  getState(): BlockState {
    return this.state;
  }

  setState(state: BlockState): void {
    this.state = state;
  }

  getInputTeamIds(): string[] {
    return this.inputTeamIds.slice();
  }

  setInputTeamIds(teamIds: string[]): void {
    this.inputTeamIds = dedupe(teamIds);
  }

  getOutputTeamIds(): string[] {
    return this.outputTeamIds.slice();
  }

  setOutputTeamIds(teamIds: string[]): void {
    this.outputTeamIds = dedupe(teamIds);
  }

  getMatches(): Match[] {
    return this.matches;
  }

  getRoundNumber(): number {
    return this.config.roundNumber ?? 1;
  }

  isPairingsLocked(): boolean {
    return this.pairingsLocked;
  }

  getLockedPairs(): Array<[string, string | 'BYE']> | undefined {
    return this.lockedPairs ? this.lockedPairs.map((p) => [p[0], p[1]] as [string, string | 'BYE']) : undefined;
  }

  lockPairings(pairs: Array<[string, string | 'BYE']>): void {
    this.pairingsLocked = true;
    this.lockedPairs = pairs.map((p) => [p[0], p[1]] as [string, string | 'BYE']);
  }

  /** Union déterministe des équipes ayant participé au bloc. */
  getAllParticipantTeamIds(): string[] {
    const ids = new Set<string>();
    for (const id of this.inputTeamIds) ids.add(id);
    for (const id of this.outputTeamIds) ids.add(id);
    for (const match of this.matches) {
      if (match.slotA.type === 'RESOLVED') ids.add(match.slotA.teamId);
      if (match.slotB.type === 'RESOLVED') ids.add(match.slotB.teamId);
    }
    return [...ids];
  }

  // ---------------------------------------------------------------------------
  // Cycle de vie
  // ---------------------------------------------------------------------------

  evaluateSkipCondition(teams: EnrichedTeam[]): boolean {
    const rule = this.config.skipCondition;
    if (!rule) return false;
    switch (rule.type) {
      case 'NEVER':
        return false;
      case 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED': {
        const team = teams.find((t) => t.originConnectorId === rule.connectorId);
        return team !== undefined && team.currentStageStats.losses === 0;
      }
      case 'SKIP_IF_FEWER_TEAMS_THAN':
        return teams.length < rule.minTeams;
      case 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS':
        return teams.length > 0 && teams.every((t) => t.currentStageStats.wins >= rule.wins);
      default:
        return false;
    }
  }

  /**
   * Réception d'un lot d'équipes (mode BATCH). Quand tous les connecteurs
   * entrants attendus ont livré, le bloc évalue son court-circuit puis génère
   * ses appariements.
   */
  receiveBatchTeams(
    teamIds: string[],
    connectorId: string | undefined,
    expectedInputsCount: number,
    registry: TournamentRegistry,
    prng: DeterministicPRNG,
    pointsConfig: PointsConfig,
  ): void {
    for (const id of teamIds) {
      if (!this.inputTeamIds.includes(id)) this.inputTeamIds.push(id);
    }
    if (connectorId) this.receivedConnectors.add(connectorId);

    if (this.state !== 'PENDING') return;
    if (this.receivedConnectors.size < expectedInputsCount) return;

    const inputTeams = this.inputTeamIds.map((id) => registry.getTeam(id));
    if (this.evaluateSkipCondition(inputTeams)) {
      this.state = 'SKIPPED';
      this.outputTeamIds = this.inputTeamIds.slice();
      this.state = 'COMPLETED';
      return;
    }

    this.state = 'SEEDING_AND_PAIRING';
    this.generateMatches(registry, prng, pointsConfig);
    const current = this.getState();
    if (current === 'COMPLETED' || current === 'SKIPPED') return;
    this.state = this.allMatchesResolved() ? 'COMPLETED' : 'IN_PROGRESS';
  }

  /**
   * Retrouve le match correspondant à une clé sémantique nominative.
   *
   * Cherche d'abord l'identifiant exact, puis bascule sur une recherche par
   * couple d'équipes (robuste au décalage de table lors d'un Causal Replay).
   */
  findMatchForResult(
    matchId: string,
    expectedTeams: [string, string],
  ): { match: Match; swapped: boolean } | null {
    const byId = this.matches.find((m) => m.id === matchId && m.state === 'READY');
    if (byId) {
      const a = resolvedTeamId(byId.slotA);
      const b = resolvedTeamId(byId.slotB);
      if (a === expectedTeams[0] && b === expectedTeams[1]) return { match: byId, swapped: false };
      if (a === expectedTeams[1] && b === expectedTeams[0]) return { match: byId, swapped: true };
    }

    for (const match of this.matches) {
      if (match.state !== 'READY') continue;
      const a = resolvedTeamId(match.slotA);
      const b = resolvedTeamId(match.slotB);
      if (a === expectedTeams[0] && b === expectedTeams[1]) return { match, swapped: false };
      if (a === expectedTeams[1] && b === expectedTeams[0]) return { match, swapped: true };
    }
    return null;
  }

  protected allMatchesResolved(): boolean {
    return this.matches.every((m) => m.state === 'COMPLETED' || m.state === 'SKIPPED');
  }

  /** Finalise les sorties du bloc (appelé par le moteur avant COMPLETED). */
  finalizeOutputs(registry: TournamentRegistry): void {
    this.outputTeamIds = dedupe(this.computeOutputs(registry));
  }

  // ---------------------------------------------------------------------------
  // Sérialisation / restauration
  // ---------------------------------------------------------------------------

  serializeState(): SerializedBlockState {
    const serialized: SerializedBlockState = {
      id: this.id,
      blockType: this.blockType,
      config: this.serializeConfig(),
      state: this.state,
      inputTeamIds: this.inputTeamIds.slice(),
      outputTeamIds: this.outputTeamIds.slice(),
      matches: structuredClone(this.matches),
      pairingsLocked: this.pairingsLocked,
      receivedConnectors: [...this.receivedConnectors],
    };
    if (this.lockedPairs) {
      serialized.lockedPairs = this.lockedPairs.map((p) => [p[0], p[1]] as [string, string | 'BYE']);
    }
    return serialized;
  }

  /** Remet le bloc dans son état initial (avant tout événement). */
  resetState(): void {
    this.state = 'PENDING';
    this.inputTeamIds = [];
    this.outputTeamIds = [];
    this.matches = [];
    this.pairingsLocked = false;
    this.lockedPairs = undefined;
    this.receivedConnectors = new Set();
    this.resetExtras();
  }

  protected resetExtras(): void {
    // hook pour les sous-classes
  }

  /** Recharge l'état dynamique depuis un snapshot. */
  loadState(snapshot: SerializedBlockState): void {
    this.state = snapshot.state;
    this.inputTeamIds = snapshot.inputTeamIds.slice();
    this.outputTeamIds = snapshot.outputTeamIds.slice();
    this.matches = structuredClone(snapshot.matches);
    this.pairingsLocked = snapshot.pairingsLocked;
    this.lockedPairs = snapshot.lockedPairs
      ? snapshot.lockedPairs.map((p) => [p[0], p[1]] as [string, string | 'BYE'])
      : undefined;
    this.receivedConnectors = new Set(snapshot.receivedConnectors);
  }
}

export function resolvedTeamId(slot: ParticipantSlot): string | undefined {
  return slot.type === 'RESOLVED' ? slot.teamId : undefined;
}

export function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

import type {
  ConnectorConfig,
  EnrichedTeam,
  Match,
  PointsConfig,
  TeamBase,
} from '../types/domain.types';
import { DEFAULT_RANKING_CRITERIA } from '../types/domain.types';
import type {
  RebaseResult,
  SerializedTournamentFull,
  SerializedTournamentSnapshot,
  TournamentEvent,
  TournamentEventPayload,
} from '../types/events.types';
import { TournamentRegistry } from '../core/registry';
import { TimeMachine, type TimeMachineHost } from '../core/time-machine';
import { Connector } from '../core/connector';
import { DeterministicPRNG } from '../utils/prng';
import { StateHasher } from '../utils/hash';
import { StandingsCalculator } from '../utils/standings';
import { AbstractTournamentBlock, resolvedTeamId } from '../blocks/abstract-block';
import { BracketRoundBlock, type BracketBlockConfig } from '../blocks/bracket-block';
import { SwissRoundBlock, type SwissBlockConfig } from '../blocks/swiss-block';
import { RoundRobinBlock, type RoundRobinBlockConfig } from '../blocks/round-robin-block';
import { MergerBlock, type MergerBlockConfig } from '../blocks/merger-block';

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  win: 3,
  draw: 1,
  loss: 0,
  bye: 3,
  forfeitWinScore: 1,
  forfeitLossScore: 0,
};

export interface TournamentGraphOptions {
  prngSeed?: number;
  pointsConfig?: Partial<PointsConfig>;
  snapshotInterval?: number;
  maxSnapshots?: number;
}

interface BlockDefinition {
  blockType: string;
  config: Record<string, unknown>;
}

/** Fabrique de blocs à partir d'une définition sérialisée. */
export function createBlock(definition: BlockDefinition): AbstractTournamentBlock {
  const config = definition.config;
  switch (definition.blockType) {
    case 'BRACKET':
      return new BracketRoundBlock(config as unknown as BracketBlockConfig);
    case 'SWISS':
      return new SwissRoundBlock(config as unknown as SwissBlockConfig);
    case 'ROUND_ROBIN':
      return new RoundRobinBlock(config as unknown as RoundRobinBlockConfig);
    case 'MERGER':
      return new MergerBlock(config as unknown as MergerBlockConfig);
    default:
      throw new Error(`createBlock: type de bloc inconnu "${definition.blockType}"`);
  }
}

/**
 * Façade principale : orchestre le DAG de blocs, applique les événements,
 * propage les résultats (STREAMING / BATCH) et expose la Time Machine.
 */
export class TournamentGraph implements TimeMachineHost {
  public readonly registry: TournamentRegistry;
  public readonly timeMachine: TimeMachine;

  private prng: DeterministicPRNG;
  private pointsConfig: PointsConfig;
  private initialPrngSeed: number;
  private readonly blocks: Map<string, AbstractTournamentBlock> = new Map();
  private connectors: ConnectorConfig[] = [];
  private manualTieBreakers: Map<string, string[]> = new Map();
  private retained: Map<string, Set<string>> = new Map();
  private completedBlocks: Set<string> = new Set();

  constructor(options: TournamentGraphOptions = {}) {
    this.initialPrngSeed = options.prngSeed ?? 42;
    this.prng = new DeterministicPRNG(this.initialPrngSeed);
    this.pointsConfig = { ...DEFAULT_POINTS_CONFIG, ...(options.pointsConfig ?? {}) };

    this.registry = new TournamentRegistry();
    this.timeMachine = new TimeMachine(this, {
      snapshotInterval: options.snapshotInterval ?? 10,
      maxSnapshots: options.maxSnapshots ?? 12,
    });

    const payload: TournamentEventPayload = {
      type: 'TOURNAMENT_INITIALIZED',
      prngSeed: this.initialPrngSeed,
      pointsConfig: { ...this.pointsConfig },
    };
    this.timeMachine.recordEvent(payload, this.getStateHash());
    this.timeMachine.saveSnapshotIfNeeded(0, this.captureSnapshot());
  }

  // ---------------------------------------------------------------------------
  // Topologie du DAG (avant start())
  // ---------------------------------------------------------------------------

  addBlock(block: AbstractTournamentBlock): this {
    if (this.blocks.has(block.id)) {
      throw new Error(`TournamentGraph: bloc déjà enregistré "${block.id}"`);
    }
    this.blocks.set(block.id, block);
    return this;
  }

  addBlocks(blocks: AbstractTournamentBlock[]): this {
    for (const block of blocks) this.addBlock(block);
    return this;
  }

  connect(
    sourceBlockId: string,
    targetBlockId: string,
    config: Omit<ConnectorConfig, 'id' | 'sourceBlockId' | 'targetBlockId'> & { id?: string },
  ): this {
    this.getBlock(sourceBlockId);
    this.getBlock(targetBlockId);

    const { id: providedId, ...rest } = config;
    const duplicateCount = this.connectors.filter(
      (c) => c.sourceBlockId === sourceBlockId && c.targetBlockId === targetBlockId,
    ).length;
    const id =
      providedId ??
      `conn_${sourceBlockId}_${targetBlockId}${duplicateCount > 0 ? `_${duplicateCount}` : ''}`;

    this.connectors.push({
      id,
      sourceBlockId,
      targetBlockId,
      ...rest,
    });
    return this;
  }

  // ---------------------------------------------------------------------------
  // Actions mutatives (chacune génère un événement)
  // ---------------------------------------------------------------------------

  seedTeams(teams: TeamBase[], entryBlockId: string): TournamentEvent {
    return this.dispatch({ type: 'TEAMS_SEEDED', blockId: entryBlockId, teams });
  }

  start(): TournamentEvent {
    return this.dispatch({ type: 'TOURNAMENT_STARTED' });
  }

  reportMatchResult(
    matchId: string,
    result: { scoreA: number; scoreB: number; winnerOverrideId?: string | 'DRAW' },
  ): TournamentEvent {
    const { block, match } = this.findMatch(matchId);
    if (match.state !== 'READY') {
      throw new Error(`TournamentGraph: le match "${matchId}" n'est pas READY (${match.state})`);
    }
    const teamA = resolvedTeamId(match.slotA);
    const teamB = resolvedTeamId(match.slotB);
    if (!teamA || !teamB) {
      throw new Error(`TournamentGraph: slots non résolus pour le match "${matchId}"`);
    }

    const payload: TournamentEventPayload = {
      type: 'MATCH_RESULT_REPORTED',
      blockId: block.id,
      matchId,
      expectedTeams: [teamA, teamB],
      scores: { [teamA]: result.scoreA, [teamB]: result.scoreB },
      ...(result.winnerOverrideId !== undefined
        ? { winnerOverrideId: result.winnerOverrideId }
        : {}),
    };
    return this.dispatch(payload);
  }

  dropTeam(teamId: string, reason?: string): TournamentEvent {
    return this.dispatch({
      type: 'TEAM_DROPPED',
      teamId,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  lockRoundPairings(blockId: string): TournamentEvent {
    const block = this.getBlock(blockId);
    const matches = block.getMatches();
    let lockedPairs: Array<[string, string | 'BYE']>;
    if (matches.length > 0) {
      lockedPairs = matches.map((match) => {
        const a = resolvedTeamId(match.slotA) ?? 'BYE';
        const b = resolvedTeamId(match.slotB) ?? 'BYE';
        return [a, b] as [string, string | 'BYE'];
      });
    } else {
      const ids = block.getInputTeamIds();
      lockedPairs = [];
      for (let i = 0; i + 1 < ids.length; i += 2) {
        lockedPairs.push([ids[i], ids[i + 1]]);
      }
    }
    return this.dispatch({ type: 'ROUND_PAIRINGS_LOCKED', blockId, lockedPairs });
  }

  overrideSeeds(blockId: string, orderedTeamIds: string[]): TournamentEvent {
    return this.dispatch({ type: 'MANUAL_SEED_OVERRIDE', blockId, orderedTeamIds });
  }

  resolveTieBreaker(connectorId: string, orderedTeamIds: string[]): TournamentEvent {
    return this.dispatch({ type: 'TIE_BREAKER_RESOLVED', connectorId, orderedTeamIds });
  }

  // ---------------------------------------------------------------------------
  // Requêtes (sans effet de bord)
  // ---------------------------------------------------------------------------

  getPlayableMatches(blockId?: string): Match[] {
    return this.getAllMatches(blockId).filter((m) => m.state === 'READY');
  }

  getAllMatches(blockId?: string): Match[] {
    if (blockId !== undefined) return this.getBlock(blockId).getMatches();
    const result: Match[] = [];
    for (const block of this.blocks.values()) result.push(...block.getMatches());
    return result;
  }

  getStandings(stageOrBlockId?: string): EnrichedTeam[] {
    let teams = this.registry.getAllTeams();
    if (stageOrBlockId !== undefined) {
      const block = this.blocks.get(stageOrBlockId);
      if (block) {
        const ids = new Set(block.getAllParticipantTeamIds());
        teams = teams.filter((t) => ids.has(t.id));
      } else {
        teams = teams.filter((t) => t.currentStageId === stageOrBlockId);
      }
    }
    return StandingsCalculator.sortTeams(teams, DEFAULT_RANKING_CRITERIA);
  }

  getBlock(blockId: string): AbstractTournamentBlock {
    const block = this.blocks.get(blockId);
    if (!block) throw new Error(`TournamentGraph: bloc introuvable "${blockId}"`);
    return block;
  }

  /** Liste (ordre d'insertion) de tous les blocs du DAG. */
  getBlocks(): AbstractTournamentBlock[] {
    return [...this.blocks.values()];
  }

  getConnectors(): ConnectorConfig[] {
    return structuredClone(this.connectors);
  }

  getStateHash(): string {
    return StateHasher.computeHash({
      teams: this.registry.serialize(),
      blocks: [...this.blocks.values()].map((b) => b.serializeState()),
      connectors: this.connectors,
      manualTieBreakers: [...this.manualTieBreakers.entries()],
      prngState: this.prng.getState(),
    });
  }

  // ---------------------------------------------------------------------------
  // Sérialisation & clonage temporel
  // ---------------------------------------------------------------------------

  toJSON(): SerializedTournamentFull {
    return {
      version: '3.0.0',
      initialPrngSeed: this.initialPrngSeed,
      pointsConfig: structuredClone(this.pointsConfig),
      blockDefinitions: [...this.blocks.values()].map((block) => ({
        blockType: block.blockType,
        config: block.serializeConfig(),
      })),
      connectorDefinitions: structuredClone(this.connectors),
      timeline: this.timeMachine.getTimeline().map((e) => structuredClone(e)),
    };
  }

  static fromJSON(json: SerializedTournamentFull): TournamentGraph {
    const graph = new TournamentGraph({
      prngSeed: json.initialPrngSeed,
      pointsConfig: json.pointsConfig,
    });
    for (const definition of json.blockDefinitions) {
      graph.addBlock(createBlock(definition));
    }
    graph.connectors = structuredClone(json.connectorDefinitions);

    graph.timeMachine.reset();
    for (let i = 0; i < json.timeline.length; i++) {
      const event = json.timeline[i];
      graph.applyEventPayload(event.payload);
      graph.timeMachine.pushEvent(structuredClone(event));
      graph.timeMachine.saveSnapshotIfNeeded(i, graph.captureSnapshot());
    }
    return graph;
  }

  // ---------------------------------------------------------------------------
  // TimeMachineHost
  // ---------------------------------------------------------------------------

  captureSnapshot(): SerializedTournamentSnapshot {
    const timeline = this.timeMachine.getTimeline();
    const head = timeline[timeline.length - 1];
    return {
      sequenceIndex: timeline.length - 1,
      lastEventId: head?.eventId ?? '',
      prngState: this.prng.getState(),
      pointsConfig: structuredClone(this.pointsConfig),
      teams: this.registry.serialize(),
      blocks: [...this.blocks.values()].map((b) => b.serializeState()),
      connectors: structuredClone(this.connectors),
      manualTieBreakers: [...this.manualTieBreakers.entries()].map(([k, v]) => [k, v.slice()]),
      retainedByBlock: [...this.retained.entries()].map(([k, v]) => [k, [...v]]),
      completedBlocks: [...this.completedBlocks],
    };
  }

  restoreSnapshot(snapshot: SerializedTournamentSnapshot): void {
    this.registry.restore(snapshot.teams);
    this.prng.setState(snapshot.prngState);
    this.pointsConfig = structuredClone(snapshot.pointsConfig);
    this.manualTieBreakers = new Map(
      snapshot.manualTieBreakers.map(([k, v]) => [k, v.slice()]),
    );
    this.retained = new Map(
      (snapshot.retainedByBlock ?? []).map(([k, v]) => [k, new Set(v)]),
    );
    this.completedBlocks = new Set(snapshot.completedBlocks ?? []);

    for (const block of this.blocks.values()) block.resetState();
    if (snapshot.blocks.length > 0) {
      for (const serialized of snapshot.blocks) {
        const block = this.blocks.get(serialized.id);
        if (block) block.loadState(serialized);
      }
    }
  }

  applyEventPayload(payload: TournamentEventPayload): void {
    switch (payload.type) {
      case 'TOURNAMENT_INITIALIZED':
        this.initialPrngSeed = payload.prngSeed;
        this.prng.setState(payload.prngSeed);
        this.pointsConfig = { ...payload.pointsConfig };
        break;

      case 'TEAMS_SEEDED': {
        const block = this.getBlock(payload.blockId);
        const stageId = block.config.stageId ?? block.id;
        this.registry.registerTeams(payload.teams, stageId);
        block.setInputTeamIds(payload.teams.map((team) => team.id));
        break;
      }

      case 'TOURNAMENT_STARTED':
        this.startTournament();
        break;

      case 'MATCH_RESULT_REPORTED':
        this.applyMatchResultPayload(payload);
        break;

      case 'TEAM_DROPPED':
        this.applyTeamDropped(payload.teamId);
        break;

      case 'ROUND_PAIRINGS_LOCKED':
        this.getBlock(payload.blockId).lockPairings(payload.lockedPairs);
        break;

      case 'MANUAL_SEED_OVERRIDE':
        payload.orderedTeamIds.forEach((teamId, index) => {
          if (this.registry.hasTeam(teamId)) this.registry.getTeam(teamId).currentSeed = index + 1;
        });
        break;

      case 'TIE_BREAKER_RESOLVED':
        this.manualTieBreakers.set(payload.connectorId, payload.orderedTeamIds.slice());
        break;
    }
  }

  prepareRebaseEvent(
    event: TournamentEvent,
  ):
    | { status: 'applied'; payload: TournamentEventPayload }
    | { status: 'orphaned'; reason: string } {
    const payload = event.payload;
    switch (payload.type) {
      case 'MATCH_RESULT_REPORTED': {
        const block = this.blocks.get(payload.blockId);
        if (!block) return { status: 'orphaned', reason: 'Block no longer exists' };

        const found = block.findMatchForResult(payload.matchId, payload.expectedTeams);
        if (!found) {
          return {
            status: 'orphaned',
            reason: 'Match pairing no longer exists in recalculated timeline',
          };
        }
        const match = found.match;
        const teamA = resolvedTeamId(match.slotA);
        const teamB = resolvedTeamId(match.slotB);
        if (!teamA || !teamB) {
          return { status: 'orphaned', reason: 'Match slots are not resolved' };
        }

        const scores: Record<string, number> = {
          [teamA]: payload.scores[teamA] ?? payload.scores[payload.expectedTeams[0]] ?? 0,
          [teamB]: payload.scores[teamB] ?? payload.scores[payload.expectedTeams[1]] ?? 0,
        };
        return {
          status: 'applied',
          payload: {
            type: 'MATCH_RESULT_REPORTED',
            blockId: payload.blockId,
            matchId: match.id,
            expectedTeams: [teamA, teamB],
            scores,
            ...(payload.winnerOverrideId !== undefined
              ? { winnerOverrideId: payload.winnerOverrideId }
              : {}),
          },
        };
      }

      case 'TIE_BREAKER_RESOLVED': {
        if (!this.connectors.some((c) => c.id === payload.connectorId)) {
          return { status: 'orphaned', reason: 'Connector no longer exists' };
        }
        const teams = payload.orderedTeamIds.map((id) =>
          this.registry.hasTeam(id) ? this.registry.getTeam(id) : undefined,
        );
        if (teams.some((t) => t === undefined)) {
          return { status: 'orphaned', reason: 'Tie-breaker teams are no longer present' };
        }
        const points = new Set(teams.map((t) => (t as EnrichedTeam).currentStageStats.points));
        if (points.size > 1) {
          return { status: 'orphaned', reason: 'Teams are no longer tied' };
        }
        return { status: 'applied', payload };
      }

      case 'TEAM_DROPPED':
        if (!this.registry.hasTeam(payload.teamId)) {
          return { status: 'orphaned', reason: 'Team no longer exists' };
        }
        return { status: 'applied', payload };

      case 'ROUND_PAIRINGS_LOCKED':
      case 'MANUAL_SEED_OVERRIDE':
        if (!this.blocks.has(payload.blockId)) {
          return { status: 'orphaned', reason: 'Block no longer exists' };
        }
        return { status: 'applied', payload };

      case 'TOURNAMENT_INITIALIZED':
      case 'TEAMS_SEEDED':
      case 'TOURNAMENT_STARTED':
        return { status: 'orphaned', reason: 'Structural event cannot be replayed in tail' };
    }
  }

  /** Point d'entrée bas niveau du Causal Replay. */
  amendEvent(
    targetEventId: string,
    newPayload: TournamentEventPayload,
    timestamp?: number,
  ): RebaseResult {
    return this.timeMachine.amendEvent(targetEventId, newPayload, timestamp);
  }

  // ---------------------------------------------------------------------------
  // Application interne des événements
  // ---------------------------------------------------------------------------

  private dispatch(payload: TournamentEventPayload, timestamp?: number): TournamentEvent {
    this.applyEventPayload(payload);
    return this.recordApplied(payload, timestamp);
  }

  private recordApplied(payload: TournamentEventPayload, timestamp?: number): TournamentEvent {
    const event = this.timeMachine.recordEvent(payload, this.getStateHash(), timestamp);
    this.timeMachine.saveSnapshotIfNeeded(event.sequenceIndex, this.captureSnapshot());
    return event;
  }

  private startTournament(): void {
    const roots = [...this.blocks.values()].filter(
      (block) => !this.connectors.some((c) => c.targetBlockId === block.id),
    );

    // 1. Génération des blocs racines.
    for (const block of roots) {
      if (block.getState() !== 'PENDING') continue;
      block.setState('SEEDING_AND_PAIRING');
      block.generateMatches(this.registry, this.prng, this.pointsConfig);
      if (block.getState() !== 'COMPLETED' && !this.isBlockFinished(block)) {
        block.setState('IN_PROGRESS');
      }
    }

    // 2. Initialisation des slots STREAMING (les matchs sources existent).
    for (const config of this.connectors) {
      if (config.transferMode !== 'STREAMING') continue;
      const source = this.getBlock(config.sourceBlockId);
      const target = this.getBlock(config.targetBlockId);
      if (!(target instanceof BracketRoundBlock)) {
        throw new Error(
          `TournamentGraph: le mode STREAMING exige un BracketRoundBlock ("${target.id}")`,
        );
      }
      const outcome = config.filterRule.type === 'LOSERS' ? 'LOSER' : 'WINNER';
      target.initializeStreamingSlots(source, outcome, config.id);
    }

    // 3. Propagation des matchs déjà résolus (BYEs) vers les slots STREAMING.
    for (const config of this.connectors) {
      if (config.transferMode !== 'STREAMING') continue;
      const source = this.getBlock(config.sourceBlockId);
      for (const match of source.getMatches()) {
        if (match.state === 'COMPLETED') this.propagateStreaming(source, match);
      }
    }

    // 4. Clôture des blocs racines déjà terminés (propagation BATCH).
    for (const block of roots) {
      if (block.getState() === 'COMPLETED' || this.isBlockFinished(block)) {
        this.completeBlock(block);
      } else {
        block.setState('IN_PROGRESS');
      }
    }
  }

  private applyMatchResultPayload(
    payload: Extract<TournamentEventPayload, { type: 'MATCH_RESULT_REPORTED' }>,
  ): void {
    const block = this.getBlock(payload.blockId);
    const found = block.findMatchForResult(payload.matchId, payload.expectedTeams);
    if (!found) {
      throw new Error(
        `TournamentGraph: appariement introuvable pour "${payload.matchId}" (${payload.expectedTeams.join(' vs ')})`,
      );
    }
    const match = found.match;
    const teamA = resolvedTeamId(match.slotA);
    const teamB = resolvedTeamId(match.slotB);
    if (!teamA || !teamB) {
      throw new Error(`TournamentGraph: slots non résolus pour "${match.id}"`);
    }
    const scoreA = payload.scores[teamA];
    const scoreB = payload.scores[teamB];
    if (scoreA === undefined || scoreB === undefined) {
      throw new Error(`TournamentGraph: scores nominatifs manquants pour "${match.id}"`);
    }
    this.applyMatchResult(block, match, scoreA, scoreB, payload.winnerOverrideId);
  }

  private applyMatchResult(
    block: AbstractTournamentBlock,
    match: Match,
    scoreA: number,
    scoreB: number,
    winnerOverrideId?: string | 'DRAW',
  ): void {
    const teamA = resolvedTeamId(match.slotA);
    const teamB = resolvedTeamId(match.slotB);
    if (!teamA || !teamB) throw new Error(`Match "${match.id}": slots non résolus`);

    let winnerId: string | 'DRAW';
    let loserId: string | 'DRAW';
    if (winnerOverrideId === 'DRAW') {
      winnerId = 'DRAW';
      loserId = 'DRAW';
    } else if (winnerOverrideId !== undefined) {
      if (winnerOverrideId !== teamA && winnerOverrideId !== teamB) {
        throw new Error(`Match "${match.id}": winnerOverrideId incohérent`);
      }
      winnerId = winnerOverrideId;
      loserId = winnerOverrideId === teamA ? teamB : teamA;
    } else if (scoreA > scoreB) {
      winnerId = teamA;
      loserId = teamB;
    } else if (scoreB > scoreA) {
      winnerId = teamB;
      loserId = teamA;
    } else {
      winnerId = 'DRAW';
      loserId = 'DRAW';
    }

    match.scoreA = scoreA;
    match.scoreB = scoreB;
    match.winnerId = winnerId;
    match.loserId = loserId;
    match.state = 'COMPLETED';

    this.recordOutcome(teamA, teamB, winnerId, scoreA, scoreB, block.id, match.id);
    this.recordOutcome(teamB, teamA, winnerId, scoreB, scoreA, block.id, match.id);
    this.registry.recomputeAllBuchholzScores();

    this.afterMatchResolved(block, match);
  }

  private recordOutcome(
    teamId: string,
    opponentId: string,
    winnerId: string | 'DRAW',
    scoreFor: number,
    scoreAgainst: number,
    blockId: string,
    matchId: string,
  ): void {
    const team = this.registry.getTeam(teamId);
    const result =
      winnerId === 'DRAW' ? 'DRAW' : winnerId === teamId ? 'WIN' : 'LOSS';
    this.registry.recordMatchOutcome(
      teamId,
      {
        stageId: team.currentStageId,
        blockId,
        matchId,
        opponentId,
        result,
        scoreFor,
        scoreAgainst,
      },
      this.pointsConfig,
    );
  }

  private applyTeamDropped(teamId: string): void {
    const team = this.registry.getTeam(teamId);
    team.status = 'DROPPED';

    const forfeits: Array<{ block: AbstractTournamentBlock; match: Match }> = [];
    for (const block of this.blocks.values()) {
      for (const match of block.getMatches()) {
        if (match.state !== 'READY') continue;
        const a = resolvedTeamId(match.slotA);
        const b = resolvedTeamId(match.slotB);
        if (a === teamId || b === teamId) forfeits.push({ block, match });
      }
    }

    for (const { block, match } of forfeits) {
      const a = resolvedTeamId(match.slotA);
      const b = resolvedTeamId(match.slotB);
      if (!a || !b) continue;
      const opponent = a === teamId ? b : a;
      const scoreA = a === teamId ? this.pointsConfig.forfeitLossScore : this.pointsConfig.forfeitWinScore;
      const scoreB = b === teamId ? this.pointsConfig.forfeitLossScore : this.pointsConfig.forfeitWinScore;
      this.applyMatchResult(block, match, scoreA, scoreB, opponent);
    }
  }

  private afterMatchResolved(block: AbstractTournamentBlock, match: Match): void {
    this.propagateStreaming(block, match);
    if (this.isBlockFinished(block)) this.completeBlock(block);
  }

  private propagateStreaming(source: AbstractTournamentBlock, match: Match): void {
    for (const config of this.connectors) {
      if (config.sourceBlockId !== source.id) continue;
      if (config.transferMode !== 'STREAMING') continue;

      const outcome = config.filterRule.type === 'LOSERS' ? 'LOSER' : 'WINNER';
      const teamId = outcome === 'WINNER' ? match.winnerId : match.loserId;
      if (teamId === undefined || teamId === 'DRAW') continue;

      const target = this.blocks.get(config.targetBlockId);
      if (!(target instanceof BracketRoundBlock)) continue;

      if (teamId !== 'BYE') {
        this.markRetained(source.id, teamId);
        this.registry.getTeam(teamId).originConnectorId = config.id;
      }

      const completed = target.resolveStreamingSlot(
        match.id,
        outcome,
        teamId,
        this.registry,
        this.pointsConfig,
      );
      for (const resolved of completed) {
        this.propagateStreaming(target, resolved);
        if (this.isBlockFinished(target)) this.completeBlock(target);
      }
    }
  }

  private completeBlock(block: AbstractTournamentBlock): void {
    if (this.completedBlocks.has(block.id)) return;
    this.completedBlocks.add(block.id);

    if (block.getState() !== 'COMPLETED' || block.getOutputTeamIds().length === 0) {
      if (block.getState() !== 'COMPLETED') block.setState('RESOLVING');
      block.finalizeOutputs(this.registry);
      block.setState('COMPLETED');
    }

    const outgoing = this.connectors.filter((c) => c.sourceBlockId === block.id);
    const participants = block
      .getAllParticipantTeamIds()
      .filter((id) => this.registry.hasTeam(id))
      .map((id) => this.registry.getTeam(id));

    for (const config of outgoing) {
      if (config.transferMode !== 'BATCH') continue;
      const connector = new Connector(config);
      const manual = this.manualTieBreakers.get(config.id);
      const qualified = connector.filterTeams(
        participants,
        block.getMatches(),
        this.registry,
        manual,
      );
      if (qualified.length === 0) continue;

      const target = this.blocks.get(config.targetBlockId);
      if (!target) continue;
      const targetStageId = config.targetStageId ?? target.config.stageId ?? target.id;

      for (const team of qualified) {
        this.registry.applyStatsReset(team.id, config.statsResetPolicy, targetStageId);
      }
      const seeded = connector.transformSeeding(qualified, this.prng);
      const expectedInputs = this.connectors.filter(
        (c) => c.targetBlockId === target.id,
      ).length;

      // Le court-circuit est évalué AVANT la réécriture d'originConnectorId :
      // il doit encore désigner le connecteur d'origine de l'équipe (ex: WB winner).
      target.receiveBatchTeams(
        seeded.map((team) => team.id),
        config.id,
        expectedInputs,
        this.registry,
        this.prng,
        this.pointsConfig,
      );

      for (const team of seeded) {
        this.markRetained(block.id, team.id);
        this.registry.getTeam(team.id).originConnectorId = config.id;
      }

      if (target.getState() === 'COMPLETED' || this.isBlockFinished(target)) {
        this.completeBlock(target);
      }
    }

    this.finalizeEliminations(block, outgoing.length > 0);
  }

  private finalizeEliminations(block: AbstractTournamentBlock, hasOutgoing: boolean): void {
    const participantIds = block
      .getAllParticipantTeamIds()
      .filter((id) => this.registry.hasTeam(id));

    if (!hasOutgoing) {
      const championId = this.pickChampion(block);
      for (const id of participantIds) {
        const team = this.registry.getTeam(id);
        if (id === championId) team.status = 'CHAMPION';
        else if (team.status === 'ACTIVE') team.status = 'ELIMINATED';
      }
      return;
    }

    const retained = this.retained.get(block.id) ?? new Set<string>();
    for (const id of participantIds) {
      const team = this.registry.getTeam(id);
      if (team.status === 'ACTIVE' && !retained.has(id)) team.status = 'ELIMINATED';
    }
  }

  private pickChampion(block: AbstractTournamentBlock): string | undefined {
    const finished = block
      .getMatches()
      .filter(
        (m) =>
          m.state === 'COMPLETED' &&
          typeof m.winnerId === 'string' &&
          m.winnerId !== 'DRAW' &&
          m.winnerId !== 'BYE',
      );
    if (finished.length > 0) {
      return finished[finished.length - 1].winnerId as string;
    }

    const teams = block
      .getInputTeamIds()
      .filter((id) => this.registry.hasTeam(id))
      .map((id) => this.registry.getTeam(id));
    if (teams.length === 0) return block.getOutputTeamIds()[0];
    const undefeated = teams.filter((t) => t.currentStageStats.losses === 0);
    if (undefeated.length === 1) return undefeated[0].id;
    return StandingsCalculator.sortTeams(teams, block.config.rankingCriteria)[0]?.id;
  }

  private isBlockFinished(block: AbstractTournamentBlock): boolean {
    const state = block.getState();
    if (state === 'COMPLETED' || state === 'SKIPPED') return true;
    if (state === 'PENDING') return false;
    return block
      .getMatches()
      .every((m) => m.state === 'COMPLETED' || m.state === 'SKIPPED');
  }

  private markRetained(blockId: string, teamId: string): void {
    let set = this.retained.get(blockId);
    if (!set) {
      set = new Set();
      this.retained.set(blockId, set);
    }
    set.add(teamId);
  }

  private findMatch(matchId: string): { block: AbstractTournamentBlock; match: Match } {
    for (const block of this.blocks.values()) {
      const match = block.getMatches().find((m) => m.id === matchId);
      if (match) return { block, match };
    }
    throw new Error(`TournamentGraph: match introuvable "${matchId}"`);
  }
}

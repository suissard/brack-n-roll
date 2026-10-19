import type {
  BlockConfigBase,
  ConnectorConfig,
  Match,
  ParticipantSlot,
  PointsConfig,
} from '../types/domain.types';
import type { TournamentRegistry } from '../core/registry';
import type { DeterministicPRNG } from '../utils/prng';
import { AbstractTournamentBlock, type BlockType } from './abstract-block';
import { resolveByeMatch, winnersOf } from './bracket-block';

export interface RoundRobinBlockConfig extends BlockConfigBase {
  /** 0 <= roundIndex < N_even - 1 */
  roundIndex: number;
}

/**
 * Une journée atomique de tournoi toutes rondes (polygone de Berger).
 */
export class RoundRobinBlock extends AbstractTournamentBlock {
  constructor(config: RoundRobinBlockConfig) {
    super(config);
  }

  get blockType(): BlockType {
    return 'ROUND_ROBIN';
  }

  get roundIndex(): number {
    return (this.config as RoundRobinBlockConfig).roundIndex;
  }

  serializeConfig(): Record<string, unknown> {
    return structuredClone(this.config) as unknown as Record<string, unknown>;
  }

  generateMatches(
    registry: TournamentRegistry,
    prng: DeterministicPRNG,
    pointsConfig: PointsConfig,
  ): void {
    void prng;
    const teams = this.inputTeamIds
      .map((id) => registry.getTeam(id))
      // Ordre stable sur toute la phase : indispensable pour que la rotation
      // du polygone de Berger parcoure bien toutes les paires.
      .sort((a, b) => a.initialSeed - b.initialSeed);

    const slots: Array<{ id: string } | null> = teams.map((t) => ({ id: t.id }));
    if (slots.length % 2 === 1) slots.push(null);

    const n = slots.length;
    if (n < 2) {
      this.matches = [];
      this.state = 'COMPLETED';
      return;
    }

    const fixed = slots[0];
    const rotating = slots.slice(1);
    const period = n - 1;
    const shift = ((this.roundIndex % period) + period) % period;
    const rotated = [...rotating.slice(shift), ...rotating.slice(0, shift)];
    const arranged = [fixed, ...rotated];

    const matches: Match[] = [];
    const half = n / 2;
    for (let i = 0; i < half; i++) {
      const left = arranged[i];
      const right = arranged[n - 1 - i];
      if (!left && !right) continue;

      let slotA: ParticipantSlot;
      let slotB: ParticipantSlot;
      const leftIsBye = left === null;
      const rightIsBye = right === null;

      // Alternance Domicile/Extérieur pour l'équipe pivot aux journées impaires.
      const swap = i === 0 && this.roundIndex % 2 === 1;
      const firstSlot: ParticipantSlot = leftIsBye ? { type: 'BYE' } : { type: 'RESOLVED', teamId: left.id };
      const secondSlot: ParticipantSlot = rightIsBye ? { type: 'BYE' } : { type: 'RESOLVED', teamId: right.id };
      slotA = swap ? secondSlot : firstSlot;
      slotB = swap ? firstSlot : secondSlot;

      const match: Match = {
        id: `${this.id}:m${matches.length}`,
        blockId: this.id,
        roundNumber: this.getRoundNumber(),
        matchIndex: matches.length,
        slotA,
        slotB,
        state: 'READY',
      };
      if (slotA.type === 'BYE' || slotB.type === 'BYE') {
        resolveByeMatch(match, registry, pointsConfig, this.id, this.getRoundNumber());
      }
      matches.push(match);
    }

    this.matches = matches;
    this.outputTeamIds = winnersOf(matches);
  }

  protected computeOutputs(registry: TournamentRegistry): string[] {
    void registry;
    return this.inputTeamIds.slice();
  }
}

export interface RoundRobinStageDefinition {
  blocks: RoundRobinBlock[];
  connectors: ConnectorConfig[];
}

/**
 * Helper de construction d'une phase complète de tournoi toutes rondes.
 * Génère R = (N pair ? N - 1 : N) journées, multipliées par 2 si aller-retour.
 */
export class RoundRobinStageMacro {
  static createStage(
    stageId: string,
    numTeams: number,
    doubleRoundRobin = false,
  ): RoundRobinStageDefinition {
    const roundsPerLeg = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
    const totalRounds = doubleRoundRobin ? roundsPerLeg * 2 : roundsPerLeg;

    const blocks: RoundRobinBlock[] = [];
    for (let i = 0; i < totalRounds; i++) {
      blocks.push(
        new RoundRobinBlock({
          id: `${stageId}:rr${i}`,
          stageId,
          roundNumber: i + 1,
          roundIndex: i % roundsPerLeg,
        }),
      );
    }

    const connectors: ConnectorConfig[] = [];
    for (let i = 0; i < blocks.length - 1; i++) {
      connectors.push({
        id: `${stageId}:conn${i}`,
        sourceBlockId: blocks[i].id,
        targetBlockId: blocks[i + 1].id,
        transferMode: 'BATCH',
        filterRule: { type: 'ALL' },
        statsResetPolicy: 'KEEP_ALL',
        targetStageId: stageId,
      });
    }

    return { blocks, connectors };
  }
}

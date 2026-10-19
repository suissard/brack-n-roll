import type {
  BlockConfigBase,
  EnrichedTeam,
  Match,
  ParticipantSlot,
  PointsConfig,
} from '../types/domain.types';
import type { TournamentRegistry } from '../core/registry';
import type { DeterministicPRNG } from '../utils/prng';
import { AbstractTournamentBlock, type BlockType, resolvedTeamId } from './abstract-block';

export interface BracketBlockConfig extends BlockConfigBase {
  /** Nombre de slots attendus en mode streaming (optionnel, informatif). */
  expectedSlots?: number;
}

/**
 * Bloc d'élimination (un tour). Supporte le mode BATCH (Fold Seeding avec
 * BYEs) et le mode STREAMING (slots pointeurs résolus match par match).
 */
export class BracketRoundBlock extends AbstractTournamentBlock {
  private streamingSlots: ParticipantSlot[] = [];

  constructor(config: BracketBlockConfig) {
    super(config);
  }

  get blockType(): BlockType {
    return 'BRACKET';
  }

  serializeConfig(): Record<string, unknown> {
    return structuredClone(this.config) as unknown as Record<string, unknown>;
  }

  // ---------------------------------------------------------------------------
  // Mode BATCH
  // ---------------------------------------------------------------------------

  generateMatches(
    registry: TournamentRegistry,
    prng: DeterministicPRNG,
    pointsConfig: PointsConfig,
  ): void {
    void prng;
    const teams = this.inputTeamIds
      .map((id) => registry.getTeam(id))
      .sort((a, b) => a.currentSeed - b.currentSeed);

    const n = teams.length;
    if (n <= 1) {
      this.matches = [];
      this.outputTeamIds = teams.map((t) => t.id);
      this.state = 'COMPLETED';
      return;
    }

    const powerOfTwo = 2 ** Math.ceil(Math.log2(n));
    const matchCount = powerOfTwo / 2;
    const matches: Match[] = [];

    for (let seed = 1; seed <= matchCount; seed++) {
      const opponentSeed = powerOfTwo + 1 - seed;
      const slotA: ParticipantSlot = { type: 'RESOLVED', teamId: teams[seed - 1].id };
      const slotB: ParticipantSlot =
        opponentSeed > n
          ? { type: 'BYE' }
          : { type: 'RESOLVED', teamId: teams[opponentSeed - 1].id };

      const match: Match = {
        id: `${this.id}:m${matches.length}`,
        blockId: this.id,
        roundNumber: this.getRoundNumber(),
        matchIndex: matches.length,
        slotA,
        slotB,
        state: 'READY',
      };
      matches.push(match);
      if (slotB.type === 'BYE') {
        resolveByeMatch(match, registry, pointsConfig, this.id, this.getRoundNumber());
      }
    }

    this.matches = matches;
    this.outputTeamIds = winnersOf(matches);
  }

  // ---------------------------------------------------------------------------
  // Mode STREAMING
  // ---------------------------------------------------------------------------

  /**
   * Pré-génère les matchs du bloc à partir des matchs du bloc source.
   * Les slots sont des `PENDING_POINTER` vers chaque match source. Les appels
   * successifs (un par connecteur entrant) empilent les slots dans un ordre
   * déterministe puis re-génèrent les appariements.
   */
  initializeStreamingSlots(
    sourceBlock: AbstractTournamentBlock,
    outcome: 'WINNER' | 'LOSER',
    connectorId: string,
  ): void {
    void connectorId;
    const sourceMatches = sourceBlock.getMatches().slice().sort((a, b) => a.matchIndex - b.matchIndex);
    for (const match of sourceMatches) {
      this.streamingSlots.push({
        type: 'PENDING_POINTER',
        sourceBlockId: sourceBlock.id,
        sourceMatchId: match.id,
        outcome,
      });
    }
    this.regenerateStreamingMatches();
    this.state = this.allMatchesResolved() ? 'COMPLETED' : 'IN_PROGRESS';
  }

  private regenerateStreamingMatches(): void {
    const matches: Match[] = [];
    for (let i = 0; i < this.streamingSlots.length; i += 2) {
      const slotA = this.streamingSlots[i];
      const slotB: ParticipantSlot = this.streamingSlots[i + 1] ?? { type: 'BYE' };
      matches.push({
        id: `${this.id}:m${matches.length}`,
        blockId: this.id,
        roundNumber: this.getRoundNumber(),
        matchIndex: matches.length,
        slotA,
        slotB,
        state: 'WAITING_FOR_SLOTS',
      });
    }
    this.matches = matches;
  }

  /**
   * Résout un slot pointant vers un match source. Retourne les matchs qui
   * viennent d'être auto-résolus (BYE) afin que le moteur les propage.
   */
  resolveStreamingSlot(
    sourceMatchId: string,
    outcome: 'WINNER' | 'LOSER',
    resolvedTeamId: string,
    registry: TournamentRegistry,
    pointsConfig: PointsConfig,
  ): Match[] {
    for (const match of this.matches) {
      for (const key of ['slotA', 'slotB'] as const) {
        const slot = match[key];
        if (
          slot.type === 'PENDING_POINTER' &&
          slot.sourceMatchId === sourceMatchId &&
          slot.outcome === outcome
        ) {
          match[key] =
            resolvedTeamId === 'BYE'
              ? { type: 'BYE' }
              : { type: 'RESOLVED', teamId: resolvedTeamId };
        }
      }
    }

    const completed: Match[] = [];
    for (const match of this.matches) {
      if (match.state !== 'WAITING_FOR_SLOTS') continue;
      const aResolved = match.slotA.type !== 'PENDING_POINTER';
      const bResolved = match.slotB.type !== 'PENDING_POINTER';
      if (!aResolved || !bResolved) continue;

      if (match.slotA.type === 'BYE' && match.slotB.type === 'BYE') {
        match.state = 'SKIPPED';
        continue;
      }
      if (match.slotA.type === 'BYE' || match.slotB.type === 'BYE') {
        resolveByeMatch(match, registry, pointsConfig, this.id, this.getRoundNumber());
        completed.push(match);
      } else {
        match.state = 'READY';
      }
    }
    this.outputTeamIds = winnersOf(this.matches);
    return completed;
  }

  protected computeOutputs(registry: TournamentRegistry): string[] {
    void registry;
    return winnersOf(this.matches);
  }

  protected resetExtras(): void {
    this.streamingSlots = [];
  }
}

/** Résout un match dont l'un des slots est un BYE. */
export function resolveByeMatch(
  match: Match,
  registry: TournamentRegistry,
  pointsConfig: PointsConfig,
  blockId: string,
  roundNumber: number,
): void {
  const a = resolvedTeamId(match.slotA);
  const b = resolvedTeamId(match.slotB);
  const winner = a ?? b;
  if (!winner) {
    match.state = 'SKIPPED';
    return;
  }

  if (a) {
    match.scoreA = pointsConfig.forfeitWinScore;
    match.scoreB = 0;
  } else {
    match.scoreA = 0;
    match.scoreB = pointsConfig.forfeitWinScore;
  }
  match.winnerId = winner;
  match.loserId = 'BYE';
  match.state = 'COMPLETED';

  registry.recordMatchOutcome(
    winner,
    {
      stageId: registry.getTeam(winner).currentStageId,
      blockId,
      matchId: match.id,
      opponentId: 'BYE',
      result: 'BYE',
      scoreFor: pointsConfig.forfeitWinScore,
      scoreAgainst: 0,
    },
    pointsConfig,
  );
  void roundNumber;
}

export function winnersOf(matches: Match[]): string[] {
  const winners: string[] = [];
  for (const match of matches) {
    if (
      match.state === 'COMPLETED' &&
      typeof match.winnerId === 'string' &&
      match.winnerId !== 'DRAW' &&
      match.winnerId !== 'BYE'
    ) {
      winners.push(match.winnerId);
    }
  }
  return winners;
}

export type { EnrichedTeam };

import type {
  BlockConfigBase,
  EnrichedTeam,
  Match,
  ParticipantSlot,
  PointsConfig,
} from '../types/domain.types';
import type { TournamentRegistry } from '../core/registry';
import type { DeterministicPRNG } from '../utils/prng';
import { StandingsCalculator } from '../utils/standings';
import { AbstractTournamentBlock, type BlockType } from './abstract-block';
import { resolveByeMatch, winnersOf } from './bracket-block';

export type SwissBlockConfig = BlockConfigBase;

/**
 * Ronde de Système Suisse (Monrad) avec backtracking anti-rematch et
 * possibilité de figer les appariements (Freeze Pairings).
 */
export class SwissRoundBlock extends AbstractTournamentBlock {
  constructor(config: SwissBlockConfig) {
    super(config);
  }

  get blockType(): BlockType {
    return 'SWISS';
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

    if (this.pairingsLocked && this.lockedPairs) {
      this.generateFromLockedPairs(registry, pointsConfig);
      return;
    }

    const activeTeams = this.inputTeamIds
      .map((id) => registry.getTeam(id))
      .filter((t) => t.status === 'ACTIVE');

    const sorted = StandingsCalculator.sortTeams(activeTeams, [
      'points',
      'buchholzScore',
      'scoreDifference',
      'initialSeed',
    ]);

    const matches: Match[] = [];
    const toPair = sorted.slice();

    if (toPair.length % 2 === 1) {
      let byeIndex = -1;
      for (let i = toPair.length - 1; i >= 0; i--) {
        if (toPair[i].currentStageStats.byes === 0) {
          byeIndex = i;
          break;
        }
      }
      if (byeIndex === -1) byeIndex = toPair.length - 1;
      const [byeTeam] = toPair.splice(byeIndex, 1);
      const match = this.createMatch(matches.length, this.id, {
        type: 'RESOLVED',
        teamId: byeTeam.id,
      }, { type: 'BYE' });
      resolveByeMatch(match, registry, pointsConfig, this.id, this.getRoundNumber());
      matches.push(match);
    }

    const pairing =
      this.findValidPairing(toPair, false) ?? this.findValidPairing(toPair, true) ?? [];

    for (const [a, b] of pairing) {
      matches.push(
        this.createMatch(
          matches.length,
          this.id,
          { type: 'RESOLVED', teamId: a.id },
          { type: 'RESOLVED', teamId: b.id },
        ),
      );
    }

    this.matches = matches;
    this.outputTeamIds = winnersOf(matches);
  }

  private generateFromLockedPairs(registry: TournamentRegistry, pointsConfig: PointsConfig): void {
    const matches: Match[] = [];
    for (const [aId, bId] of this.lockedPairs ?? []) {
      const aExists = registry.hasTeam(aId);
      const bIsTeam = bId !== 'BYE' && registry.hasTeam(bId);
      if (!aExists) continue;
      const slotA: ParticipantSlot = { type: 'RESOLVED', teamId: aId };
      const slotB: ParticipantSlot = bIsTeam
        ? { type: 'RESOLVED', teamId: bId }
        : { type: 'BYE' };
      const match = this.createMatch(matches.length, this.id, slotA, slotB);
      if (!bIsTeam) {
        resolveByeMatch(match, registry, pointsConfig, this.id, this.getRoundNumber());
      }
      matches.push(match);
    }
    this.matches = matches;
    this.outputTeamIds = winnersOf(matches);
  }

  private createMatch(
    index: number,
    blockId: string,
    slotA: ParticipantSlot,
    slotB: ParticipantSlot,
  ): Match {
    return {
      id: `${blockId}:m${index}`,
      blockId,
      roundNumber: this.getRoundNumber(),
      matchIndex: index,
      slotA,
      slotB,
      state: 'READY',
    };
  }

  /**
   * Appariement récursif avec backtracking. Retourne `null` si aucun couplage
   * complet n'existe sous la contrainte de non-rematch.
   */
  private findValidPairing(
    remaining: EnrichedTeam[],
    allowRematch: boolean,
  ): Array<[EnrichedTeam, EnrichedTeam]> | null {
    if (remaining.length === 0) return [];
    if (remaining.length % 2 !== 0) return null;

    const first = remaining[0];
    for (let k = 1; k < remaining.length; k++) {
      const candidate = remaining[k];
      if (!allowRematch && this.hasPlayed(first, candidate)) continue;

      const rest = remaining.filter((_, index) => index !== 0 && index !== k);
      const sub = this.findValidPairing(rest, allowRematch);
      if (sub !== null) {
        return [[first, candidate], ...sub];
      }
    }
    return null;
  }

  private hasPlayed(a: EnrichedTeam, b: EnrichedTeam): boolean {
    return a.currentStageHistory.some((entry) => entry.opponentId === b.id);
  }

  protected computeOutputs(registry: TournamentRegistry): string[] {
    void registry;
    return this.inputTeamIds.slice();
  }
}

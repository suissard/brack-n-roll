import type { EnrichedTeam, RankingCriterion } from '../types/domain.types';
import { DEFAULT_RANKING_CRITERIA } from '../types/domain.types';

/**
 * Tri multi-critères déterministe du classement d'une phase.
 *
 * Le tri est stable, sans effet de bord (une copie est retournée) et se
 * termine toujours par un tri lexicographique sur `id` afin de garantir un
 * déterminisme total, même en cas d'égalité parfaite.
 */
export class StandingsCalculator {
  static sortTeams(
    teams: EnrichedTeam[],
    criteria?: RankingCriterion[],
    manualTieBreakerOrder?: string[],
  ): EnrichedTeam[] {
    const effectiveCriteria =
      criteria && criteria.length > 0 ? criteria : DEFAULT_RANKING_CRITERIA;
    const copy = teams.slice();
    copy.sort((a, b) => StandingsCalculator.compare(a, b, effectiveCriteria, manualTieBreakerOrder));
    return copy;
  }

  private static compare(
    a: EnrichedTeam,
    b: EnrichedTeam,
    criteria: RankingCriterion[],
    manual?: string[],
  ): number {
    for (const criterion of criteria) {
      let diff = 0;
      switch (criterion) {
        case 'points':
          diff = b.currentStageStats.points - a.currentStageStats.points;
          break;
        case 'buchholzScore':
          diff = b.currentStageStats.buchholzScore - a.currentStageStats.buchholzScore;
          break;
        case 'scoreDifference':
          diff = b.currentStageStats.scoreDifference - a.currentStageStats.scoreDifference;
          break;
        case 'wins':
          diff = b.currentStageStats.wins - a.currentStageStats.wins;
          break;
        case 'headToHead':
          diff = StandingsCalculator.headToHead(a, b);
          break;
        case 'initialSeed':
          if (manual) {
            const ia = manual.indexOf(a.id);
            const ib = manual.indexOf(b.id);
            if (ia >= 0 && ib >= 0 && ia !== ib) diff = ia - ib;
          }
          if (diff === 0) diff = a.initialSeed - b.initialSeed;
          break;
      }
      if (diff !== 0) return diff;
    }
    return a.id.localeCompare(b.id);
  }

  /** Nombre de victoires directes de `a` contre `b` moins l'inverse. */
  private static headToHead(a: EnrichedTeam, b: EnrichedTeam): number {
    let aWins = 0;
    let bWins = 0;
    for (const entry of a.currentStageHistory) {
      if (entry.opponentId !== b.id) continue;
      if (entry.result === 'WIN') aWins += 1;
      else if (entry.result === 'LOSS') bWins += 1;
    }
    return bWins - aWins;
  }
}

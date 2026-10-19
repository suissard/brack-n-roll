import type {
  ConnectorConfig,
  EnrichedTeam,
  FilterRuleDSL,
  Match,
  RankingCriterion,
  SeedingTransform,
} from '../types/domain.types';
import { DeterministicPRNG } from '../utils/prng';
import { StandingsCalculator } from '../utils/standings';
import { DEFAULT_RANKING_CRITERIA } from '../types/domain.types';
import type { TournamentRegistry } from './registry';

/**
 * Connecteur entre deux blocs du DAG.
 *
 * Il applique un filtrage déclaratif (DSL JSON), une transformation de seeding
 * et transmet les équipes qualifiées au bloc cible.
 */
export class Connector {
  readonly config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  /**
   * Trie puis filtre les équipes du bloc source.
   * Les équipes `DROPPED` sont systématiquement exclues.
   */
  filterTeams(
    teams: EnrichedTeam[],
    sourceMatches: Match[],
    registry: TournamentRegistry,
    manualTieBreaker?: string[],
  ): EnrichedTeam[] {
    void registry;
    const criteria: RankingCriterion[] =
      this.config.rankingCriteria && this.config.rankingCriteria.length > 0
        ? this.config.rankingCriteria
        : DEFAULT_RANKING_CRITERIA;

    const eligible = teams.filter((t) => t.status !== 'DROPPED' && t.status !== 'ELIMINATED');
    const sorted = StandingsCalculator.sortTeams(eligible, criteria, manualTieBreaker);
    const rule = this.config.filterRule;

    switch (rule.type) {
      case 'ALL':
        return sorted;
      case 'WINNERS': {
        const winners = new Set<string>();
        for (const match of sourceMatches) {
          if (match.state !== 'COMPLETED') continue;
          if (typeof match.winnerId === 'string' && match.winnerId !== 'DRAW') {
            winners.add(match.winnerId);
          }
        }
        return sorted.filter((t) => winners.has(t.id));
      }
      case 'LOSERS': {
        const losers = new Set<string>();
        for (const match of sourceMatches) {
          if (match.state !== 'COMPLETED') continue;
          if (typeof match.loserId === 'string' && match.loserId !== 'DRAW') {
            losers.add(match.loserId);
          }
        }
        return sorted.filter((t) => losers.has(t.id));
      }
      case 'TOP_N':
        return sorted.slice(0, Math.max(0, rule.count));
      case 'BOTTOM_N':
        return rule.count <= 0 ? [] : sorted.slice(-rule.count);
      case 'RANGE':
        return sorted.slice(Math.max(0, rule.startRank - 1), Math.max(0, rule.endRank));
      case 'MIN_POINTS':
        return sorted.filter((t) => t.currentStageStats.points >= rule.points);
      case 'EXACT_WINS':
        return sorted.filter((t) => t.currentStageStats.wins === rule.wins);
      case 'EXACT_LOSSES':
        return sorted.filter((t) => t.currentStageStats.losses === rule.losses);
      default:
        return assertNever(rule);
    }
  }

  /** Applique la transformation de seeding configurée puis réindexe `currentSeed` 1..N. */
  transformSeeding(teams: EnrichedTeam[], prng: DeterministicPRNG): EnrichedTeam[] {
    const transform: SeedingTransform = this.config.seedingTransform ?? 'KEEP';
    let ordered: EnrichedTeam[];

    switch (transform) {
      case 'KEEP':
        ordered = teams.slice();
        break;
      case 'REVERSE':
        ordered = teams.slice().reverse();
        break;
      case 'SHUFFLE':
        ordered = prng.shuffle(teams);
        break;
      case 'CROSS_OVER':
        ordered = crossOver(teams);
        break;
      case 'SNAKE':
        ordered = snake(teams);
        break;
      default:
        ordered = teams.slice();
    }

    ordered.forEach((team, index) => {
      team.currentSeed = index + 1;
    });
    return ordered;
  }
}

/** 1, N, 2, N-1, ... (entrelacement tête / queue). */
function crossOver(teams: EnrichedTeam[]): EnrichedTeam[] {
  if (teams.length <= 2) return teams.slice();
  const half = Math.ceil(teams.length / 2);
  const first = teams.slice(0, half);
  const second = teams.slice(half).reverse();
  const result: EnrichedTeam[] = [];
  for (let i = 0; i < half; i++) {
    if (first[i]) result.push(first[i]);
    if (second[i]) result.push(second[i]);
  }
  return result;
}

/** Serpentin : entrelace la première moitié et la seconde moitié (ordre direct). */
function snake(teams: EnrichedTeam[]): EnrichedTeam[] {
  if (teams.length <= 2) return teams.slice();
  const half = Math.ceil(teams.length / 2);
  const first = teams.slice(0, half);
  const second = teams.slice(half);
  const result: EnrichedTeam[] = [];
  for (let i = 0; i < half; i++) {
    if (first[i]) result.push(first[i]);
    if (second[i]) result.push(second[i]);
  }
  return result;
}

function assertNever(value: never): never {
  throw new Error(`FilterRuleDSL non supportée: ${JSON.stringify(value)}`);
}

export type { FilterRuleDSL };

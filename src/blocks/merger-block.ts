import type { BlockConfigBase, EnrichedTeam, PointsConfig } from '../types/domain.types';
import type { TournamentRegistry } from '../core/registry';
import type { DeterministicPRNG } from '../utils/prng';
import { StandingsCalculator } from '../utils/standings';
import { DEFAULT_RANKING_CRITERIA } from '../types/domain.types';
import { AbstractTournamentBlock, type BlockType } from './abstract-block';

export type MergerBlockConfig = BlockConfigBase;

/**
 * Bloc de synchronisation : ne génère aucun match, attend toutes ses entrées,
 * trie globalement les qualifiés et réattribue les seeds 1..K.
 */
export class MergerBlock extends AbstractTournamentBlock {
  constructor(config: MergerBlockConfig) {
    super(config);
  }

  get blockType(): BlockType {
    return 'MERGER';
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
    void pointsConfig;
    const teams: EnrichedTeam[] = this.inputTeamIds
      .map((id) => registry.getTeam(id))
      .filter((t) => t.status !== 'DROPPED' && t.status !== 'ELIMINATED');

    const criteria = this.config.rankingCriteria ?? DEFAULT_RANKING_CRITERIA;
    const sorted = StandingsCalculator.sortTeams(teams, criteria);
    sorted.forEach((team, index) => {
      team.currentSeed = index + 1;
    });
    this.matches = [];
    this.outputTeamIds = sorted.map((t) => t.id);
  }

  protected computeOutputs(registry: TournamentRegistry): string[] {
    void registry;
    return this.outputTeamIds.slice();
  }
}

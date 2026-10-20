import type { ConnectorConfig, PointsConfig, TeamBase } from './domain.types';

/**
 * Description déclarative et 100 % sérialisable d'un format de tournoi.
 *
 * Un format contient tout ce qu'il faut pour construire le DAG *avant* la
 * timeline : graine PRNG, barème de points, blocs, connecteurs et équipes
 * seedées. Il peut être stocké en base, édité dans l'interface puis transformé
 * en `TournamentGraph` exécutable.
 */

export type FormatBlockType = 'BRACKET' | 'SWISS' | 'ROUND_ROBIN' | 'MERGER';

export interface FormatBlockDefinition {
  blockType: FormatBlockType;
  /** Configuration sérialisée du bloc (`BlockConfigBase` + champs spécifiques). */
  config: Record<string, unknown>;
}

export interface TournamentFormatMeta {
  id: string;
  name: string;
  description?: string;
}

export interface TournamentFormat extends TournamentFormatMeta {
  version: '1.0.0';
  prngSeed: number;
  pointsConfig: PointsConfig;
  /** Bloc recevant le seeding initial (`TEAMS_SEEDED`). */
  entryBlockId: string;
  teams: TeamBase[];
  blocks: FormatBlockDefinition[];
  connectors: ConnectorConfig[];
}

export interface FormatValidationIssue {
  path: string;
  message: string;
}

/**
 * Contrats de données du domaine (V3.0).
 *
 * Toutes les structures sont 100% sérialisables en JSON : aucune fonction,
 * aucune instance de classe n'est stockée dans la configuration d'un bloc
 * ou d'un connecteur. Les filtres et conditions de court-circuit passent par
 * un DSL déclaratif.
 */

export type TeamStatus = 'ACTIVE' | 'ELIMINATED' | 'DROPPED' | 'CHAMPION';
export type MatchOutcome = 'WIN' | 'LOSS' | 'DRAW' | 'BYE';
export type MatchState = 'WAITING_FOR_SLOTS' | 'READY' | 'COMPLETED' | 'SKIPPED';
export type BlockState =
  | 'PENDING'
  | 'SKIPPED'
  | 'SEEDING_AND_PAIRING'
  | 'IN_PROGRESS'
  | 'RESOLVING'
  | 'COMPLETED';
export type TransferMode = 'BATCH' | 'STREAMING';
export type StatsResetPolicy = 'KEEP_ALL' | 'ARCHIVE_AND_RESET_ALL' | 'RESET_POINTS_KEEP_HISTORY';
export type SeedingTransform = 'KEEP' | 'REVERSE' | 'SHUFFLE' | 'CROSS_OVER' | 'SNAKE';
export type RankingCriterion =
  | 'points'
  | 'buchholzScore'
  | 'scoreDifference'
  | 'wins'
  | 'headToHead'
  | 'initialSeed';

export interface PointsConfig {
  win: number;
  draw: number;
  loss: number;
  bye: number;
  /** Score attribué par défaut en cas de forfait adverse (ex: 1). */
  forfeitWinScore: number;
  /** Score attribué au forfaitaire (ex: 0). */
  forfeitLossScore: number;
}

export interface TeamBase {
  id: string;
  name: string;
  initialSeed: number;
  customMeta?: Record<string, unknown>;
}

export interface MatchHistoryEntry {
  stageId: string;
  blockId: string;
  matchId: string;
  opponentId: string | 'BYE';
  result: MatchOutcome;
  scoreFor: number;
  scoreAgainst: number;
}

export interface TeamStats {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  buchholzScore: number;
  /** Positif = série de victoires, négatif = série de défaites. */
  currentStreak: number;
}

export interface ArchivedStage {
  stageId: string;
  sourceBlockId: string;
  finalSeedInStage: number;
  stats: TeamStats;
  history: MatchHistoryEntry[];
}

export interface EnrichedTeam extends TeamBase {
  currentSeed: number;
  status: TeamStatus;
  originConnectorId?: string;
  currentStageId: string;
  currentStageStats: TeamStats;
  currentStageHistory: MatchHistoryEntry[];
  pastStages: ArchivedStage[];
}

export type ParticipantSlot =
  | { type: 'RESOLVED'; teamId: string }
  | { type: 'BYE' }
  | { type: 'PENDING_POINTER'; sourceBlockId: string; sourceMatchId: string; outcome: 'WINNER' | 'LOSER' };

export interface Match {
  /** Format déterministe : `${blockId}:m${matchIndex}`. */
  id: string;
  blockId: string;
  roundNumber: number;
  matchIndex: number;
  slotA: ParticipantSlot;
  slotB: ParticipantSlot;
  scoreA?: number;
  scoreB?: number;
  winnerId?: string | 'DRAW';
  loserId?: string | 'DRAW';
  state: MatchState;
}

/** DSL déclaratif 100% sérialisable pour filtrer les équipes dans un connecteur. */
export type FilterRuleDSL =
  | { type: 'ALL' }
  | { type: 'WINNERS' }
  | { type: 'LOSERS' }
  | { type: 'TOP_N'; count: number }
  | { type: 'BOTTOM_N'; count: number }
  | { type: 'RANGE'; startRank: number; endRank: number }
  | { type: 'MIN_POINTS'; points: number }
  | { type: 'EXACT_WINS'; wins: number }
  | { type: 'EXACT_LOSSES'; losses: number };

/** DSL déclaratif 100% sérialisable pour le court-circuit conditionnel d'un bloc. */
export type SkipConditionDSL =
  | { type: 'NEVER' }
  | { type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED'; connectorId: string }
  | { type: 'SKIP_IF_FEWER_TEAMS_THAN'; minTeams: number }
  | { type: 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS'; wins: number };

export interface ConnectorConfig {
  id: string;
  sourceBlockId: string;
  targetBlockId: string;
  transferMode: TransferMode;
  filterRule: FilterRuleDSL;
  seedingTransform?: SeedingTransform;
  statsResetPolicy: StatsResetPolicy;
  targetStageId?: string;
  rankingCriteria?: RankingCriterion[];
}

export interface BlockConfigBase {
  id: string;
  stageId?: string;
  roundNumber?: number;
  skipCondition?: SkipConditionDSL;
  rankingCriteria?: RankingCriterion[];
}

export const DEFAULT_RANKING_CRITERIA: RankingCriterion[] = [
  'points',
  'buchholzScore',
  'scoreDifference',
  'wins',
  'headToHead',
  'initialSeed',
];

import type {
  TeamBase,
  ConnectorConfig,
  EnrichedTeam,
  Match,
  BlockState,
  PointsConfig,
} from './domain.types';

/**
 * Charge utile d'un événement. Toute mutation du tournoi passe par un
 * `TournamentEventPayload` : la timeline est donc la seule source de vérité.
 */
export type TournamentEventPayload =
  | { type: 'TOURNAMENT_INITIALIZED'; prngSeed: number; pointsConfig: PointsConfig }
  | { type: 'TEAMS_SEEDED'; blockId: string; teams: TeamBase[] }
  | { type: 'TEAM_RENAMED'; teamId: string; name: string }
  | { type: 'TOURNAMENT_STARTED' }
  | {
      type: 'MATCH_RESULT_REPORTED';
      blockId: string;
      matchId: string;
      /** [teamAId, teamBId] au moment de la saisie (clé sémantique nominative). */
      expectedTeams: [string, string];
      /** Clé = teamId, valeur = score : survit à une inversion Domicile/Extérieur. */
      scores: Record<string, number>;
      winnerOverrideId?: string | 'DRAW';
    }
  | { type: 'TEAM_DROPPED'; teamId: string; reason?: string }
  | { type: 'ROUND_PAIRINGS_LOCKED'; blockId: string; lockedPairs: Array<[string, string | 'BYE']> }
  | { type: 'MANUAL_SEED_OVERRIDE'; blockId: string; orderedTeamIds: string[] }
  | { type: 'TIE_BREAKER_RESOLVED'; connectorId: string; orderedTeamIds: string[] };

export interface TournamentEvent {
  /** Format déterministe : `evt_${sequenceIndex}_${shortHash}`. */
  eventId: string;
  sequenceIndex: number;
  /** N'influence jamais le stateHash. */
  timestamp: number;
  payload: TournamentEventPayload;
  /** Hash FNV-1a déterministe de l'état après application de l'événement. */
  stateHash: string;
}

export interface OrphanedEventInfo {
  event: TournamentEvent;
  reason: string;
}

export interface RebaseResult {
  appliedEvents: TournamentEvent[];
  orphanedEvents: OrphanedEventInfo[];
  newHeadStateHash: string;
}

/** Résultat de la suppression d'un événement de la timeline. */
export interface DeleteEventResult extends RebaseResult {
  removedEvent: TournamentEvent;
}

/** Résultat d'un retour en arrière (troncature de la timeline). */
export interface RewindResult {
  removedEvents: TournamentEvent[];
  newHeadStateHash: string;
}

export interface SerializedBlockState {
  id: string;
  blockType: 'BRACKET' | 'SWISS' | 'ROUND_ROBIN' | 'MERGER';
  config: Record<string, unknown>;
  state: BlockState;
  inputTeamIds: string[];
  outputTeamIds: string[];
  matches: Match[];
  pairingsLocked: boolean;
  lockedPairs?: Array<[string, string | 'BYE']>;
  receivedConnectors: string[];
}

export interface SerializedTournamentSnapshot {
  sequenceIndex: number;
  lastEventId: string;
  prngState: number;
  pointsConfig: PointsConfig;
  /** Permet de rejouer un `TOURNAMENT_STARTED` sans redémarrer deux fois. */
  started?: boolean;
  teams: Array<[string, EnrichedTeam]>;
  blocks: SerializedBlockState[];
  connectors: ConnectorConfig[];
  /** connectorId -> orderedTeamIds */
  manualTieBreakers: Array<[string, string[]]>;
  retainedByBlock: Array<[string, string[]]>;
  completedBlocks: string[];
}

export interface SerializedTournamentFull {
  version: '3.0.0';
  initialPrngSeed: number;
  pointsConfig: PointsConfig;
  blockDefinitions: Array<{ blockType: string; config: Record<string, unknown> }>;
  connectorDefinitions: ConnectorConfig[];
  timeline: TournamentEvent[];
}

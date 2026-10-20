import {
  TournamentGraph,
  createGraphFromFormat,
  type BlockState,
  type ConnectorConfig,
  type EnrichedTeam,
  type Match,
  type TournamentEvent,
  type TournamentEventPayload,
  type TournamentFormat,
} from '../../../src/index';
import { tournamentApi } from '../db/tournamentApi';
import { SCENARIOS, buildScenario, scenarioMeta, type ScenarioId } from './scenarios';

function isScenarioId(id: string): id is ScenarioId {
  return SCENARIOS.some((scenario) => scenario.id === id);
}

export interface BlockView {
  id: string;
  type: string;
  state: BlockState;
  stageId: string;
  roundNumber: number;
  inputTeamIds: string[];
  outputTeamIds: string[];
  matches: Match[];
  /** Configuration sérialisée du bloc (ex: `roundIndex` d'une journée). */
  config: Record<string, unknown>;
}

export type RebaseAction = 'amend' | 'delete' | 'rewind' | 'reseed';

export interface RebaseSummary {
  action: RebaseAction;
  targetEventId: string;
  applied: number;
  orphaned: number;
  /** Nombre d'événements réellement retirés de la timeline. */
  removed: number;
  /** Motifs d'orphelinage, pour expliquer les répercussions. */
  reasons: string[];
  newHeadStateHash: string;
}

export interface TournamentView {
  status: 'loading' | 'ready' | 'error';
  busy: boolean;
  error: string | null;
  /** Identifiant du scénario intégré ou du format chargé. */
  scenarioId: string;
  scenarioName: string;
  sourceKind: 'scenario' | 'format';
  started: boolean;
  teams: EnrichedTeam[];
  standings: EnrichedTeam[];
  /** Bloc d'entrée du seeding (dernier `TEAMS_SEEDED`). */
  seedBlockId: string | null;
  /** Équipes ordonnées par seed initial (ordre de seeding éditable). */
  seedOrder: EnrichedTeam[];
  blocks: BlockView[];
  connectors: ConnectorConfig[];
  playableMatches: Match[];
  timeline: TournamentEvent[];
  stateHash: string;
  revision: number;
  updatedAt: string | null;
  storageBytes: number;
  lastRebase: RebaseSummary | null;
}

const EMPTY_VIEW: TournamentView = {
  status: 'loading',
  busy: false,
  error: null,
  scenarioId: 'swiss-topcut-8',
  scenarioName: scenarioMeta('swiss-topcut-8').name,
  sourceKind: 'scenario',
  started: false,
  teams: [],
  standings: [],
  seedBlockId: null,
  seedOrder: [],
  blocks: [],
  connectors: [],
  playableMatches: [],
  timeline: [],
  stateHash: '',
  revision: 0,
  updatedAt: null,
  storageBytes: 0,
  lastRebase: null,
};

/**
 * Store observable côté client.
 *
 * Il ne contient que l'état « de session » (vue dérivée, indicateurs UI). La
 * donnée durable vit dans le faux backend `tournamentApi` / `localStorage`.
 */
class TournamentStore {
  private graph: TournamentGraph | null = null;
  private scenarioId: string = 'swiss-topcut-8';
  private scenarioName: string = scenarioMeta('swiss-topcut-8').name;
  private sourceKind: TournamentView['sourceKind'] = 'scenario';
  private status: TournamentView['status'] = 'loading';
  private busy = false;
  private error: string | null = null;
  private lastRebase: RebaseSummary | null = null;
  private revision = 0;
  private updatedAt: string | null = null;
  private storageBytes = 0;
  private initialized = false;

  private snapshot: TournamentView = { ...EMPTY_VIEW };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TournamentView => this.snapshot;

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): TournamentView {
    const graph = this.graph;
    if (!graph) {
      return { ...EMPTY_VIEW, status: this.status, busy: this.busy, error: this.error };
    }

    const timeline = graph.timeMachine.getTimeline().slice();
    const seedEvent = [...timeline]
      .reverse()
      .find((event) => event.payload.type === 'TEAMS_SEEDED');
    const seedBlockId =
      seedEvent && seedEvent.payload.type === 'TEAMS_SEEDED' ? seedEvent.payload.blockId : null;
    const seedOrder = graph.registry
      .getAllTeams()
      .slice()
      .sort(
        (a, b) =>
          a.initialSeed - b.initialSeed ||
          a.currentSeed - b.currentSeed ||
          a.id.localeCompare(b.id),
      );
    const blocks: BlockView[] = graph.getBlocks().map((block) => ({
      id: block.id,
      type: block.blockType,
      state: block.getState(),
      stageId: block.config.stageId ?? block.id,
      roundNumber: block.getRoundNumber(),
      inputTeamIds: block.getInputTeamIds(),
      outputTeamIds: block.getOutputTeamIds(),
      matches: block.getMatches(),
      config: block.serializeConfig(),
    }));

    return {
      status: this.status,
      busy: this.busy,
      error: this.error,
      scenarioId: this.scenarioId,
      scenarioName: this.scenarioName,
      sourceKind: this.sourceKind,
      started: timeline.some((event) => event.payload.type === 'TOURNAMENT_STARTED'),
      teams: graph.registry.getAllTeams(),
      standings: graph.getStandings(),
      seedBlockId,
      seedOrder,
      blocks,
      connectors: graph.getConnectors(),
      playableMatches: graph.getPlayableMatches(),
      timeline,
      stateHash: graph.getStateHash(),
      revision: this.revision,
      updatedAt: this.updatedAt,
      storageBytes: this.storageBytes,
      lastRebase: this.lastRebase,
    };
  }

  private syncDbMeta(): void {
    const stats = tournamentApi.stats();
    this.revision = stats.revision;
    this.updatedAt = stats.updatedAt;
    this.storageBytes = stats.bytes;
  }

  private async persist(): Promise<void> {
    if (!this.graph) return;
    await tournamentApi.save(this.scenarioId, this.graph.toJSON(), this.scenarioName);
    this.syncDbMeta();
  }

  /** Charge le tournoi depuis le backend, ou initialise le scénario par défaut. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.status = 'loading';
    this.emit();
    try {
      const stored = await tournamentApi.load();
      if (stored) {
        this.scenarioId = stored.scenarioId;
        this.sourceKind = isScenarioId(stored.scenarioId) ? 'scenario' : 'format';
        this.scenarioName =
          stored.name ??
          (isScenarioId(stored.scenarioId)
            ? scenarioMeta(stored.scenarioId).name
            : stored.scenarioId);
        this.graph = TournamentGraph.fromJSON(stored.state);
      } else {
        const defaultId: ScenarioId = 'swiss-topcut-8';
        this.scenarioId = defaultId;
        this.sourceKind = 'scenario';
        this.scenarioName = scenarioMeta(defaultId).name;
        this.graph = buildScenario(defaultId);
        await this.persist();
      }
      this.syncDbMeta();
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    }
    this.emit();
  }

  /** (Re)crée un scénario et le persiste. */
  async loadScenario(id: ScenarioId): Promise<void> {
    this.busy = true;
    this.error = null;
    this.lastRebase = null;
    this.emit();
    try {
      this.scenarioId = id;
      this.scenarioName = scenarioMeta(id).name;
      this.sourceKind = 'scenario';
      this.graph = buildScenario(id);
      await this.persist();
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /**
   * Instancie un format édité : construit le DAG, seed les équipes, démarre le
   * tournoi et le persiste dans le backend courant.
   */
  async loadFormat(format: TournamentFormat): Promise<void> {
    this.busy = true;
    this.error = null;
    this.lastRebase = null;
    this.emit();
    try {
      const graph = createGraphFromFormat(format, { autoStart: true });
      this.scenarioId = format.id;
      this.scenarioName = format.name;
      this.sourceKind = 'format';
      this.graph = graph;
      await this.persist();
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Recharge l'état depuis le backend (simule un refetch). */
  async refresh(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const stored = await tournamentApi.load();
      if (stored) {
        this.scenarioId = stored.scenarioId;
        this.sourceKind = isScenarioId(stored.scenarioId) ? 'scenario' : 'format';
        this.scenarioName =
          stored.name ??
          (isScenarioId(stored.scenarioId)
            ? scenarioMeta(stored.scenarioId).name
            : stored.scenarioId);
        this.graph = TournamentGraph.fromJSON(stored.state);
        this.syncDbMeta();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Vide le backend puis recharge le scénario courant. */
  async clearStorage(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      await tournamentApi.clear();
      const scenarioId: ScenarioId = isScenarioId(this.scenarioId)
        ? this.scenarioId
        : 'swiss-topcut-8';
      this.scenarioId = scenarioId;
      this.scenarioName = scenarioMeta(scenarioId).name;
      this.sourceKind = 'scenario';
      this.graph = buildScenario(scenarioId);
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private async mutate(operation: (graph: TournamentGraph) => void): Promise<void> {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      operation(this.graph);
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  start = (): Promise<void> => this.mutate((graph) => graph.start());

  reportResult = (
    matchId: string,
    scoreA: number,
    scoreB: number,
    winnerOverrideId?: string | 'DRAW',
  ): Promise<void> =>
    this.mutate((graph) =>
      graph.reportMatchResult(matchId, {
        scoreA,
        scoreB,
        ...(winnerOverrideId !== undefined ? { winnerOverrideId } : {}),
      }),
    );

  dropTeam = (teamId: string, reason?: string): Promise<void> =>
    this.mutate((graph) => graph.dropTeam(teamId, reason));

  renameTeam = (teamId: string, name: string): Promise<void> =>
    this.mutate((graph) => graph.renameTeam(teamId, name));

  /** Réécrit un événement passé et rejoue la queue (Causal Replay). */
  amendEvent = async (eventId: string, payload: TournamentEventPayload): Promise<void> => {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const result = this.graph.amendEvent(eventId, payload);
      this.lastRebase = {
        action: 'amend',
        targetEventId: eventId,
        applied: result.appliedEvents.length,
        orphaned: result.orphanedEvents.length,
        removed: 0,
        reasons: result.orphanedEvents.map((info) => info.reason),
        newHeadStateHash: result.newHeadStateHash,
      };
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  };

  /** Supprime un événement passé et montre les répercussions sur la suite. */
  deleteEvent = async (eventId: string): Promise<void> => {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const result = this.graph.deleteEvent(eventId);
      this.lastRebase = {
        action: 'delete',
        targetEventId: eventId,
        applied: result.appliedEvents.length,
        orphaned: result.orphanedEvents.length,
        removed: 1 + result.orphanedEvents.length,
        reasons: result.orphanedEvents.map((info) => info.reason),
        newHeadStateHash: result.newHeadStateHash,
      };
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  };

  /** Remonte le temps jusqu'à un événement (les suivants sont supprimés). */
  rewindTo = async (eventId: string): Promise<void> => {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const result = this.graph.rewindTo(eventId);
      this.lastRebase = {
        action: 'rewind',
        targetEventId: eventId,
        applied: 0,
        orphaned: 0,
        removed: result.removedEvents.length,
        reasons: [],
        newHeadStateHash: result.newHeadStateHash,
      };
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  };

  /** Réécrit l'ordre de seeding dans la Time Machine et rejoue le tournoi. */
  reseed = async (blockId: string, orderedTeamIds: string[]): Promise<void> => {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const result = this.graph.reseedTeams(blockId, orderedTeamIds);
      this.lastRebase = {
        action: 'reseed',
        targetEventId: result.targetEventId,
        applied: result.appliedEvents.length,
        orphaned: result.orphanedEvents.length,
        removed: 0,
        reasons: result.orphanedEvents.map((info) => info.reason),
        newHeadStateHash: result.newHeadStateHash,
      };
      await this.persist();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  };
}

export const tournamentStore = new TournamentStore();

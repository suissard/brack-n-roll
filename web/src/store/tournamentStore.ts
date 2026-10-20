import {
  TournamentGraph,
  type BlockState,
  type ConnectorConfig,
  type EnrichedTeam,
  type Match,
  type TournamentEvent,
  type TournamentEventPayload,
} from '../../../src/index';
import { tournamentApi } from '../db/tournamentApi';
import { buildScenario, scenarioMeta, type ScenarioId } from './scenarios';

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

export interface RebaseSummary {
  targetEventId: string;
  applied: number;
  orphaned: number;
  newHeadStateHash: string;
}

export interface TournamentView {
  status: 'loading' | 'ready' | 'error';
  busy: boolean;
  error: string | null;
  scenarioId: ScenarioId;
  scenarioName: string;
  started: boolean;
  teams: EnrichedTeam[];
  standings: EnrichedTeam[];
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
  started: false,
  teams: [],
  standings: [],
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
  private scenarioId: ScenarioId = 'swiss-topcut-8';
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
      scenarioName: scenarioMeta(this.scenarioId).name,
      started: timeline.some((event) => event.payload.type === 'TOURNAMENT_STARTED'),
      teams: graph.registry.getAllTeams(),
      standings: graph.getStandings(),
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
    await tournamentApi.save(this.scenarioId, this.graph.toJSON());
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
        this.scenarioId = stored.scenarioId as ScenarioId;
        this.graph = TournamentGraph.fromJSON(stored.state);
      } else {
        this.graph = buildScenario(this.scenarioId);
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

  /** Recharge l'état depuis le backend (simule un refetch). */
  async refresh(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const stored = await tournamentApi.load();
      if (stored) {
        this.scenarioId = stored.scenarioId as ScenarioId;
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
      this.graph = buildScenario(this.scenarioId);
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

  /** Réécrit un événement passé et rejoue la queue (Causal Replay). */
  amendEvent = async (eventId: string, payload: TournamentEventPayload): Promise<void> => {
    if (!this.graph) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const result = this.graph.amendEvent(eventId, payload);
      this.lastRebase = {
        targetEventId: eventId,
        applied: result.appliedEvents.length,
        orphaned: result.orphanedEvents.length,
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

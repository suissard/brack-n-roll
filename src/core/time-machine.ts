import type {
  OrphanedEventInfo,
  RebaseResult,
  SerializedTournamentSnapshot,
  TournamentEvent,
  TournamentEventPayload,
} from '../types/events.types';

/**
 * Contrat exposé par `TournamentGraph` à la Time Machine : la Time Machine
 * possède le journal, le graphe possède la logique d'application.
 */
export interface TimeMachineHost {
  captureSnapshot(): SerializedTournamentSnapshot;
  restoreSnapshot(snapshot: SerializedTournamentSnapshot): void;
  applyEventPayload(payload: TournamentEventPayload): void;
  getStateHash(): string;
  /**
   * Prépare le rejeu d'un événement aval. Le graphe valide l'événement contre
   * le nouvel état et retourne la charge utile à appliquer (éventuellement
   * réécrite pour une clé nominative), ou un motif d'orphelinage.
   */
  prepareRebaseEvent(
    event: TournamentEvent,
  ):
    | { status: 'applied'; payload: TournamentEventPayload }
    | { status: 'orphaned'; reason: string };
}

export interface TimeMachineOptions {
  /** Intervalle d'événements entre deux snapshots (défaut : 10). */
  snapshotInterval?: number;
  /** Nombre maximal de snapshots conservés (défaut : 12). */
  maxSnapshots?: number;
}

/**
 * Journal d'événements immuable, cache LRU de snapshots et réécriture causale
 * du passé (Causal Replay).
 */
export class TimeMachine {
  private timeline: TournamentEvent[] = [];
  private snapshots: Map<number, SerializedTournamentSnapshot> = new Map();
  private readonly maxSnapshots: number;
  private readonly snapshotInterval: number;
  private readonly host: TimeMachineHost;

  constructor(host: TimeMachineHost, options: TimeMachineOptions = {}) {
    this.host = host;
    this.maxSnapshots = Math.max(1, options.maxSnapshots ?? 12);
    this.snapshotInterval = Math.max(1, options.snapshotInterval ?? 10);
  }

  getTimeline(): readonly TournamentEvent[] {
    return this.timeline.slice();
  }

  getLength(): number {
    return this.timeline.length;
  }

  getHead(): TournamentEvent | undefined {
    return this.timeline[this.timeline.length - 1];
  }

  /** Enregistre un événement déjà appliqué. `currentStateHash` = hash après application. */
  recordEvent(
    payload: TournamentEventPayload,
    currentStateHash: string,
    timestamp?: number,
  ): TournamentEvent {
    const sequenceIndex = this.timeline.length;
    const event: TournamentEvent = {
      eventId: `evt_${sequenceIndex}_${currentStateHash.slice(0, 6)}`,
      sequenceIndex,
      timestamp: timestamp ?? sequenceIndex,
      payload,
      stateHash: currentStateHash,
    };
    this.timeline.push(event);
    return event;
  }

  /** Ajoute un événement déjà construit (restauration de `fromJSON`). */
  pushEvent(event: TournamentEvent): void {
    this.timeline.push(event);
  }

  saveSnapshotIfNeeded(sequenceIndex: number, snapshot: SerializedTournamentSnapshot): void {
    if (sequenceIndex !== 0 && sequenceIndex % this.snapshotInterval !== 0) return;
    this.snapshots.set(sequenceIndex, structuredClone(snapshot));

    if (this.snapshots.size > this.maxSnapshots) {
      const keys = [...this.snapshots.keys()].sort((a, b) => a - b);
      for (const key of keys) {
        if (key > 0) {
          this.snapshots.delete(key);
          break;
        }
      }
    }
  }

  getSnapshot(sequenceIndex: number): SerializedTournamentSnapshot | undefined {
    return this.snapshots.get(sequenceIndex);
  }

  getNearestSnapshotBefore(targetSequenceIndex: number): SerializedTournamentSnapshot | undefined {
    let best: number | undefined;
    for (const key of this.snapshots.keys()) {
      if (key <= targetSequenceIndex && (best === undefined || key > best)) {
        best = key;
      }
    }
    return best === undefined ? undefined : this.snapshots.get(best);
  }

  reset(): void {
    this.timeline = [];
    this.snapshots.clear();
  }

  /**
   * Réécrit un événement passé et rejoue causalement toute la queue.
   *
   * Les événements aval devenus incompatibles (match qui n'existe plus,
   * tie-breaker obsolète, ...) sont orphelins ; les autres sont conservés et
   * re-appliqués dans le nouvel ordre.
   */
  amendEvent(
    targetEventId: string,
    newPayload: TournamentEventPayload,
    timestamp?: number,
  ): RebaseResult {
    const k = this.timeline.findIndex((event) => event.eventId === targetEventId);
    if (k < 0) throw new Error(`TimeMachine: événement introuvable "${targetEventId}"`);
    if (k === 0) throw new Error('TimeMachine: TOURNAMENT_INITIALIZED ne peut pas être amendé');

    const originalTimestamp = this.timeline[k].timestamp;
    const tailEvents = this.timeline.slice(k + 1);

    const snapshot = this.getNearestSnapshotBefore(k - 1);
    if (!snapshot) throw new Error('TimeMachine: aucun snapshot disponible pour la restauration');
    this.host.restoreSnapshot(snapshot);

    // Rejoue les événements déjà validés entre le snapshot et k-1.
    for (let i = snapshot.sequenceIndex + 1; i <= k - 1; i++) {
      this.host.applyEventPayload(this.timeline[i].payload);
    }

    // Tronque la timeline à k (l'événement cible est remplacé).
    this.timeline = this.timeline.slice(0, k);

    // Applique la modification.
    this.host.applyEventPayload(newPayload);
    const amendedHash = this.host.getStateHash();
    const amendedEvent: TournamentEvent = {
      eventId: `evt_${k}_${amendedHash.slice(0, 6)}`,
      sequenceIndex: k,
      timestamp: timestamp ?? originalTimestamp,
      payload: newPayload,
      stateHash: amendedHash,
    };
    this.timeline.push(amendedEvent);
    this.saveSnapshotIfNeeded(k, this.host.captureSnapshot());

    const appliedEvents: TournamentEvent[] = [];
    const orphanedEvents: OrphanedEventInfo[] = [];

    for (const oldEvent of tailEvents) {
      const prepared = this.host.prepareRebaseEvent(oldEvent);
      if (prepared.status === 'orphaned') {
        orphanedEvents.push({ event: oldEvent, reason: prepared.reason });
        continue;
      }

      this.host.applyEventPayload(prepared.payload);
      const stateHash = this.host.getStateHash();
      const sequenceIndex = this.timeline.length;
      const replayed: TournamentEvent = {
        eventId: `evt_${sequenceIndex}_${stateHash.slice(0, 6)}`,
        sequenceIndex,
        timestamp: oldEvent.timestamp,
        payload: prepared.payload,
        stateHash,
      };
      this.timeline.push(replayed);
      this.saveSnapshotIfNeeded(sequenceIndex, this.host.captureSnapshot());
      appliedEvents.push(replayed);
    }

    // Purge les snapshots situés au-delà de la nouvelle tête.
    const headIndex = this.timeline.length - 1;
    for (const key of [...this.snapshots.keys()]) {
      if (key > headIndex) this.snapshots.delete(key);
    }

    return {
      appliedEvents,
      orphanedEvents,
      newHeadStateHash: this.host.getStateHash(),
    };
  }
}

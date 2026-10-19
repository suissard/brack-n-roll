import type { SerializedTournamentFull } from '../../../src/index';
import { db, type DbStats } from './fakeDatabase';

/**
 * Couche "repository" du tournoi : c'est le seul endroit qui parle au backend.
 * Aujourd'hui `db` est un faux client `localStorage` ; demain un vrai client HTTP
 * avec les mêmes méthodes suffirait.
 */

const COLLECTION = 'tournaments';
const CURRENT_ID = 'current';

export interface StoredTournament {
  scenarioId: string;
  savedAt: string;
  state: SerializedTournamentFull;
}

export const tournamentApi = {
  async load(): Promise<StoredTournament | null> {
    return db.find<StoredTournament>(COLLECTION, CURRENT_ID);
  },

  async save(scenarioId: string, state: SerializedTournamentFull): Promise<StoredTournament> {
    const record: StoredTournament = {
      scenarioId,
      savedAt: new Date().toISOString(),
      state,
    };
    return db.insert<StoredTournament>(COLLECTION, CURRENT_ID, record);
  },

  async clear(): Promise<boolean> {
    return db.remove(COLLECTION, CURRENT_ID);
  },

  stats(): DbStats {
    return db.stats();
  },
};

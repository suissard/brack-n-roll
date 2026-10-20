import type { TournamentFormat } from '../../../src/index';
import { FakeDatabase } from './fakeDatabase';

/**
 * Second faux backend, dédié aux formats de tournoi.
 *
 * Il possède sa propre clé `localStorage` (donc son propre « serveur » local),
 * indépendante du tournoi en cours. Pour brancher une vraie base, il suffit de
 * réimplémenter cette façade avec les mêmes méthodes asynchrones.
 */

const STORAGE_KEY = 'brack-n-roll::formats-fake-db::v1';
const LEGACY_STORAGE_KEY = 'algo-tournament::formats-fake-db::v1';
const COLLECTION = 'formats';

export const formatDb = new FakeDatabase(140, STORAGE_KEY, LEGACY_STORAGE_KEY);

export interface StoredFormat {
  id: string;
  name: string;
  description: string;
  savedAt: string;
  format: TournamentFormat;
}

export const formatApi = {
  async list(): Promise<StoredFormat[]> {
    return formatDb.list<StoredFormat>(COLLECTION);
  },

  async find(id: string): Promise<StoredFormat | null> {
    return formatDb.find<StoredFormat>(COLLECTION, id);
  },

  async save(format: TournamentFormat): Promise<StoredFormat> {
    const record: StoredFormat = {
      id: format.id,
      name: format.name,
      description: format.description ?? '',
      savedAt: new Date().toISOString(),
      format: structuredClone(format),
    };
    return formatDb.insert<StoredFormat>(COLLECTION, format.id, record);
  },

  async remove(id: string): Promise<boolean> {
    return formatDb.remove(COLLECTION, id);
  },

  async clear(): Promise<void> {
    return formatDb.clear();
  },

  stats() {
    return formatDb.stats();
  },
};

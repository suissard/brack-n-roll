/**
 * Faux client de base de données.
 *
 * Il expose une API asynchrone (latence simulée + collections + révision) calquée
 * sur un vrai backend, mais persiste dans `localStorage`. Le reste de l'app ne
 * sait pas que le backend est factice : pour brancher une vraie base, il suffit
 * de réimplémenter cette classe avec la même interface.
 *
 * Note : `Date`/`Math.random` sont utilisés ici uniquement pour la métadonnée de
 * stockage (révision, horodatage) — jamais dans la logique de tournoi qui reste
 * strictement déterministe.
 */

const DB_STORAGE_KEY = 'algo-tournament::fake-db::v1';

interface DbShape {
  collections: Record<string, Record<string, unknown>>;
  revision: number;
  updatedAt: string | null;
}

export interface DbStats {
  revision: number;
  updatedAt: string | null;
  collections: string[];
  keys: Record<string, number>;
  bytes: number;
}

function emptyShape(): DbShape {
  return { collections: {}, revision: 0, updatedAt: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeDatabase {
  private shape: DbShape;
  private readonly latencyMs: number;

  constructor(latencyMs = 160) {
    this.latencyMs = latencyMs;
    this.shape = this.read();
  }

  private read(): DbShape {
    if (typeof localStorage === 'undefined') return emptyShape();
    try {
      const raw = localStorage.getItem(DB_STORAGE_KEY);
      if (!raw) return emptyShape();
      const parsed = JSON.parse(raw) as DbShape;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.collections !== 'object') {
        return emptyShape();
      }
      return {
        collections: parsed.collections ?? {},
        revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
        updatedAt: parsed.updatedAt ?? null,
      };
    } catch {
      return emptyShape();
    }
  }

  private write(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(this.shape));
    } catch {
      // quota dépassé ou stockage indisponible : on ignore silencieusement.
    }
  }

  private collection(name: string): Record<string, unknown> {
    if (!this.shape.collections[name]) this.shape.collections[name] = {};
    return this.shape.collections[name];
  }

  /** SELECT * FROM collection */
  async list<T>(collection: string): Promise<T[]> {
    await sleep(this.latencyMs);
    return Object.values(this.collection(collection)) as T[];
  }

  /** SELECT ... WHERE id = ? */
  async find<T>(collection: string, id: string): Promise<T | null> {
    await sleep(this.latencyMs);
    const value = this.collection(collection)[id];
    return value === undefined ? null : (value as T);
  }

  /** INSERT ... ON CONFLICT DO UPDATE */
  async insert<T>(collection: string, id: string, value: T): Promise<T> {
    await sleep(this.latencyMs);
    this.collection(collection)[id] = value;
    this.shape.revision += 1;
    this.shape.updatedAt = new Date().toISOString();
    this.write();
    return value;
  }

  /** DELETE ... WHERE id = ? */
  async remove(collection: string, id: string): Promise<boolean> {
    await sleep(this.latencyMs);
    const target = this.collection(collection);
    const existed = id in target;
    delete target[id];
    if (existed) {
      this.shape.revision += 1;
      this.shape.updatedAt = new Date().toISOString();
    }
    this.write();
    return existed;
  }

  /** DROP DATABASE */
  async clear(): Promise<void> {
    await sleep(this.latencyMs);
    this.shape = emptyShape();
    this.shape.revision += 1;
    this.shape.updatedAt = new Date().toISOString();
    this.write();
  }

  stats(): DbStats {
    const keys: Record<string, number> = {};
    for (const [name, rows] of Object.entries(this.shape.collections)) {
      keys[name] = Object.keys(rows).length;
    }
    const raw =
      typeof localStorage === 'undefined' ? '' : localStorage.getItem(DB_STORAGE_KEY) ?? '';
    return {
      revision: this.shape.revision,
      updatedAt: this.shape.updatedAt,
      collections: Object.keys(this.shape.collections),
      keys,
      bytes: raw.length,
    };
  }
}

export const db = new FakeDatabase();

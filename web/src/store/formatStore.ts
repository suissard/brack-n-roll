import {
  validateTournamentFormat,
  type FormatValidationIssue,
  type TournamentFormat,
} from '../../../src/index';
import { formatApi } from '../db/formatApi';
import { getFormatTemplates } from './formatTemplates';

export interface FormatSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  savedAt: string | null;
  teamCount: number;
  blockCount: number;
}

export interface FormatViewState {
  status: 'loading' | 'ready' | 'error';
  busy: boolean;
  error: string | null;
  summaries: FormatSummary[];
  draft: TournamentFormat | null;
  activeId: string | null;
  dirty: boolean;
  issues: FormatValidationIssue[];
  revision: number;
  updatedAt: string | null;
  storageBytes: number;
  storageCount: number;
}

const EMPTY_VIEW: FormatViewState = {
  status: 'loading',
  busy: false,
  error: null,
  summaries: [],
  draft: null,
  activeId: null,
  dirty: false,
  issues: [],
  revision: 0,
  updatedAt: null,
  storageBytes: 0,
  storageCount: 0,
};

let idCounter = 0;

function newFormatId(): string {
  idCounter += 1;
  return `format-${Date.now().toString(36)}-${idCounter}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Store observable de l'éditeur de formats.
 *
 * Le brouillon vit en mémoire ; la sauvegarde passe exclusivement par
 * `formatApi`, qui possède son propre faux backend local (clé `localStorage`
 * distincte du tournoi en cours). Le jour où une vraie base arrive, seule la
 * façade `formatApi` change.
 */
class FormatStore {
  private stored: Awaited<ReturnType<typeof formatApi.list>> = [];
  private templates = getFormatTemplates();
  private draft: TournamentFormat | null = null;
  private activeId: string | null = null;
  private savedSnapshot: string | null = null;
  private issues: FormatValidationIssue[] = [];
  private status: FormatViewState['status'] = 'loading';
  private busy = false;
  private error: string | null = null;
  private revision = 0;
  private updatedAt: string | null = null;
  private storageBytes = 0;
  private storageCount = 0;
  private initialized = false;

  private snapshot: FormatViewState = { ...EMPTY_VIEW };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FormatViewState => this.snapshot;

  private emit(): void {
    this.snapshot = {
      status: this.status,
      busy: this.busy,
      error: this.error,
      summaries: this.buildSummaries(),
      draft: this.draft ? clone(this.draft) : null,
      activeId: this.activeId,
      dirty:
        this.draft !== null &&
        (this.savedSnapshot === null || JSON.stringify(this.draft) !== this.savedSnapshot),
      issues: [...this.issues],
      revision: this.revision,
      updatedAt: this.updatedAt,
      storageBytes: this.storageBytes,
      storageCount: this.storageCount,
    };
    for (const listener of this.listeners) listener();
  }

  private buildSummaries(): FormatSummary[] {
    const builtins: FormatSummary[] = this.templates.map((format) => ({
      id: format.id,
      name: format.name,
      description: format.description ?? '',
      source: 'builtin',
      savedAt: null,
      teamCount: format.teams.length,
      blockCount: format.blocks.length,
    }));
    const customs: FormatSummary[] = this.stored.map((record) => ({
      id: record.id,
      name: record.name,
      description: record.description,
      source: 'custom',
      savedAt: record.savedAt,
      teamCount: record.format.teams.length,
      blockCount: record.format.blocks.length,
    }));
    return [...builtins, ...customs];
  }

  private syncStats(): void {
    const stats = formatApi.stats();
    this.revision = stats.revision;
    this.updatedAt = stats.updatedAt;
    this.storageBytes = stats.bytes;
    this.storageCount = stats.keys.formats ?? 0;
  }

  /** Charge la liste des formats stockés. Idempotent. */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.reload(true);
    this.initialized = this.status !== 'error';
  }

  private async reload(resetDraft: boolean): Promise<void> {
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      this.stored = await formatApi.list();
      this.syncStats();
      this.status = 'ready';
      if (resetDraft) {
        const latest = [...this.stored].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
        const template = this.templates[0];
        if (latest) {
          this.draft = clone(latest.format);
          this.activeId = latest.id;
          this.savedSnapshot = JSON.stringify(latest.format);
          this.issues = validateTournamentFormat(this.draft);
        } else if (template) {
          this.draft = { ...clone(template), id: newFormatId() };
          this.activeId = null;
          this.savedSnapshot = null;
          this.issues = validateTournamentFormat(this.draft);
        }
      }
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Recharge le backend de formats (simule un refetch). */
  async refresh(): Promise<void> {
    await this.reload(false);
  }

  getTemplates(): TournamentFormat[] {
    return this.templates.map((format) => clone(format));
  }

  /** Sélectionne un modèle intégré (nouveau brouillon) ou un format sauvegardé. */
  select(id: string): void {
    const template = this.templates.find((format) => format.id === id);
    if (template) {
      this.draft = { ...clone(template), id: newFormatId() };
      this.activeId = null;
      this.savedSnapshot = null;
      this.issues = validateTournamentFormat(this.draft);
      this.error = null;
      this.emit();
      return;
    }

    const record = this.stored.find((entry) => entry.id === id);
    if (!record) {
      this.error = `Format introuvable : ${id}`;
      this.emit();
      return;
    }

    this.draft = clone(record.format);
    this.activeId = record.id;
    this.savedSnapshot = JSON.stringify(record.format);
    this.issues = validateTournamentFormat(this.draft);
    this.error = null;
    this.emit();
  }

  /** Instancie un modèle vierge ou un modèle intégré. */
  newFormat(templateId?: string): void {
    const template =
      this.templates.find((format) => format.id === templateId) ??
      this.templates.find((format) => format.id === 'template:blank') ??
      this.templates[0];
    if (!template) return;
    this.draft = { ...clone(template), id: newFormatId() };
    this.activeId = null;
    this.savedSnapshot = null;
    this.issues = validateTournamentFormat(this.draft);
    this.error = null;
    this.emit();
  }

  /** Duplique le brouillon courant en un nouveau format non enregistré. */
  duplicate(): void {
    if (!this.draft) return;
    this.draft = {
      ...clone(this.draft),
      id: newFormatId(),
      name: `${this.draft.name} (copie)`,
    };
    this.activeId = null;
    this.savedSnapshot = null;
    this.issues = validateTournamentFormat(this.draft);
    this.error = null;
    this.emit();
  }

  /** Applique une mutation immuable au brouillon et revalide le format. */
  updateDraft(updater: (draft: TournamentFormat) => TournamentFormat): void {
    if (!this.draft) return;
    this.draft = updater(this.draft);
    this.issues = validateTournamentFormat(this.draft);
    this.error = null;
    this.emit();
  }

  /** Persiste le brouillon dans le faux backend de formats. */
  async save(): Promise<void> {
    if (!this.draft) return;
    const issues = validateTournamentFormat(this.draft);
    this.issues = issues;
    if (issues.length > 0) {
      this.error = 'Le format contient des erreurs : corrigez-le avant de sauvegarder.';
      this.emit();
      return;
    }

    const toSave = clone(this.draft);
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      const saved = await formatApi.save(toSave);
      this.stored = await formatApi.list();
      this.syncStats();
      this.activeId = saved.id;
      this.savedSnapshot = JSON.stringify(toSave);
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Supprime un format personnalisé (les modèles intégrés sont immuables). */
  async remove(id: string): Promise<void> {
    if (this.templates.some((format) => format.id === id)) return;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      await formatApi.remove(id);
      this.stored = await formatApi.list();
      this.syncStats();
      if (this.activeId === id || this.draft?.id === id) {
        this.draft = null;
        this.activeId = null;
        this.savedSnapshot = null;
        this.issues = [];
      }
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Vide le backend de formats (pas le tournoi en cours). */
  async clearStorage(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      await formatApi.clear();
      this.stored = await formatApi.list();
      this.syncStats();
      this.draft = null;
      this.activeId = null;
      this.savedSnapshot = null;
      this.issues = [];
      this.status = 'ready';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    } finally {
      this.busy = false;
      this.emit();
    }
  }
}

export const formatStore = new FormatStore();

import type { ReactNode } from 'react';
import type {
  ConnectorConfig,
  FilterRuleDSL,
  FormatBlockDefinition,
  PointsConfig,
  RankingCriterion,
  SeedingTransform,
  SkipConditionDSL,
  StatsResetPolicy,
  TeamBase,
  TournamentFormat,
  TransferMode,
} from '../../../src/index';
import { useFormats } from '../hooks/useFormats';
import { formatStore } from '../store/formatStore';

interface Props {
  onOpenInConsole: (format: TournamentFormat) => void;
}

const BLOCK_TYPES: Array<{ value: FormatBlockDefinition['blockType']; label: string }> = [
  { value: 'SWISS', label: 'Suisse' },
  { value: 'BRACKET', label: 'Tableau (bracket)' },
  { value: 'ROUND_ROBIN', label: 'Toutes rondes' },
  { value: 'MERGER', label: 'Fusion (merger)' },
];

const RANKING_CRITERIA: RankingCriterion[] = [
  'points',
  'buchholzScore',
  'scoreDifference',
  'wins',
  'headToHead',
  'initialSeed',
];

const FILTER_TYPES: Array<{ value: FilterRuleDSL['type']; label: string }> = [
  { value: 'ALL', label: 'Toutes les équipes' },
  { value: 'WINNERS', label: 'Vainqueurs' },
  { value: 'LOSERS', label: 'Perdants' },
  { value: 'TOP_N', label: 'Top N' },
  { value: 'BOTTOM_N', label: 'Bas de tableau N' },
  { value: 'RANGE', label: 'Plage de rangs' },
  { value: 'MIN_POINTS', label: 'Points minimum' },
  { value: 'EXACT_WINS', label: 'Exactement N victoires' },
  { value: 'EXACT_LOSSES', label: 'Exactement N défaites' },
];

const SKIP_TYPES: Array<{ value: SkipConditionDSL['type']; label: string }> = [
  { value: 'NEVER', label: 'Jamais' },
  { value: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED', label: 'Si une équipe du connecteur est invaincue' },
  { value: 'SKIP_IF_FEWER_TEAMS_THAN', label: "Si moins de N équipes" },
  { value: 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS', label: 'Si toutes les équipes ont N victoires' },
];

const TRANSFER_MODES: Array<{ value: TransferMode; label: string }> = [
  { value: 'BATCH', label: 'BATCH (tous les qualifiés ensemble)' },
  { value: 'STREAMING', label: 'STREAMING (au fil des matchs)' },
];

const STATS_RESET_POLICIES: Array<{ value: StatsResetPolicy; label: string }> = [
  { value: 'KEEP_ALL', label: 'Conserver les statistiques' },
  { value: 'ARCHIVE_AND_RESET_ALL', label: 'Archiver puis remettre à zéro' },
  { value: 'RESET_POINTS_KEEP_HISTORY', label: 'Reset points, garder l’historique' },
];

const SEEDING_TRANSFORMS: Array<{ value: SeedingTransform; label: string }> = [
  { value: 'KEEP', label: 'Conserver' },
  { value: 'REVERSE', label: 'Inverser' },
  { value: 'SHUFFLE', label: 'Mélanger (PRNG)' },
  { value: 'CROSS_OVER', label: 'Croisement' },
  { value: 'SNAKE', label: 'Serpentin (snake)' },
];

const POINTS_FIELDS: Array<{ key: keyof PointsConfig; label: string }> = [
  { key: 'win', label: 'Victoire' },
  { key: 'draw', label: 'Nul' },
  { key: 'loss', label: 'Défaite' },
  { key: 'bye', label: 'Bye' },
  { key: 'forfeitWinScore', label: 'Forfait gagné' },
  { key: 'forfeitLossScore', label: 'Forfait perdu' },
];

function defaultFilterRule(type: FilterRuleDSL['type']): FilterRuleDSL {
  switch (type) {
    case 'WINNERS':
      return { type: 'WINNERS' };
    case 'LOSERS':
      return { type: 'LOSERS' };
    case 'TOP_N':
      return { type: 'TOP_N', count: 4 };
    case 'BOTTOM_N':
      return { type: 'BOTTOM_N', count: 4 };
    case 'RANGE':
      return { type: 'RANGE', startRank: 1, endRank: 4 };
    case 'MIN_POINTS':
      return { type: 'MIN_POINTS', points: 3 };
    case 'EXACT_WINS':
      return { type: 'EXACT_WINS', wins: 1 };
    case 'EXACT_LOSSES':
      return { type: 'EXACT_LOSSES', losses: 1 };
    case 'ALL':
    default:
      return { type: 'ALL' };
  }
}

function defaultSkipCondition(type: SkipConditionDSL['type'], connectorId: string): SkipConditionDSL {
  switch (type) {
    case 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED':
      return { type, connectorId };
    case 'SKIP_IF_FEWER_TEAMS_THAN':
      return { type, minTeams: 2 };
    case 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS':
      return { type, wins: 1 };
    case 'NEVER':
    default:
      return { type: 'NEVER' };
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normaliseSeeds(teams: TeamBase[]): TeamBase[] {
  return teams.map((team, index) => ({ ...team, initialSeed: index + 1 }));
}

function uniqueId(prefix: string, existing: string[]): string {
  let index = existing.length + 1;
  let candidate = `${prefix}-${index}`;
  while (existing.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR');
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`format-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * Éditeur de formats de tournoi.
 *
 * Le format est un document JSON pur (blocs, connecteurs, seeding, barème). Il
 * est sauvegardé dans un faux backend dédié puis peut être instancié dans la
 * console pour jouer le tournoi correspondant.
 */
export function FormatEditor({ onOpenInConsole }: Props) {
  const view = useFormats();
  const draft = view.draft;
  const blockIds = draft
    ? draft.blocks.map((block) => asString(block.config.id))
    : [];
  const selectedValue = view.activeId ?? draft?.id ?? '';

  const hasErrors = view.issues.length > 0;

  const confirmDiscard = (): boolean =>
    !view.dirty || window.confirm('Le brouillon non enregistré sera perdu. Continuer ?');

  const remove = async () => {
    if (!view.activeId) return;
    if (!window.confirm('Supprimer définitivement ce format du stockage local ?')) return;
    await formatStore.remove(view.activeId);
  };

  const clearAll = async () => {
    if (!window.confirm('Vider tout le stockage local des formats ?')) return;
    await formatStore.clearStorage();
  };

  return (
    <div className="format-editor">
      <section className="toolbar">
        <label className="field">
          <span>Format</span>
          <select
            value={selectedValue}
            onChange={(event) => {
              if (event.target.value === selectedValue) return;
              if (!confirmDiscard()) {
                event.target.value = selectedValue;
                return;
              }
              formatStore.select(event.target.value);
            }}
            disabled={view.busy}
          >
            {view.activeId === null && draft && (
              <option value={draft.id}>{draft.name} (non enregistré)</option>
            )}
            <optgroup label="Modèles intégrés">
              {view.summaries
                .filter((summary) => summary.source === 'builtin')
                .map((summary) => (
                  <option key={summary.id} value={summary.id}>
                    {summary.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Formats enregistrés">
              {view.summaries
                .filter((summary) => summary.source === 'custom')
                .map((summary) => (
                  <option key={summary.id} value={summary.id}>
                    {summary.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>

        <button
          type="button"
          onClick={() => {
            if (confirmDiscard()) formatStore.newFormat();
          }}
          disabled={view.busy}
        >
          Nouveau (vierge)
        </button>

        <button
          type="button"
          onClick={() => formatStore.duplicate()}
          disabled={view.busy || !draft}
        >
          Dupliquer
        </button>

        <button
          type="button"
          className="primary"
          onClick={() => void formatStore.save()}
          disabled={view.busy || !draft || hasErrors}
        >
          Enregistrer
        </button>

        <button
          type="button"
          disabled={view.busy || !draft || hasErrors}
          onClick={() => {
            if (draft) onOpenInConsole(structuredClone(draft));
          }}
        >
          Ouvrir dans la console
        </button>

        <button
          type="button"
          className="ghost danger"
          onClick={() => void remove()}
          disabled={view.busy || !view.activeId}
        >
          Supprimer
        </button>

        <button
          type="button"
          className="ghost danger"
          onClick={() => void clearAll()}
          disabled={view.busy}
        >
          Vider les formats
        </button>

        {view.busy && <span className="spinner" aria-label="Chargement" />}
      </section>

      {view.error && <div className="banner error">{view.error}</div>}

      <p className="muted format-storage-line">
        {view.storageCount} format(s) dans le faux backend local · révision #{view.revision} ·{' '}
        {formatDate(view.updatedAt)} · {view.storageBytes} octets
        {draft && view.dirty ? ' · brouillon non enregistré' : ''}
      </p>

      {view.status === 'loading' && !draft ? (
        <p className="loading">Chargement des formats depuis le backend local…</p>
      ) : !draft ? (
        <section className="panel empty-state">
          <h2>Aucun brouillon</h2>
          <p className="muted">
            Choisissez un modèle intégré ou créez un format vierge pour commencer.
          </p>
          <div className="format-inline-actions">
            {view.summaries
              .filter((summary) => summary.source === 'builtin')
              .map((summary) => (
                <button
                  key={summary.id}
                  type="button"
                  onClick={() => formatStore.select(summary.id)}
                >
                  {summary.name}
                </button>
              ))}
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <header className="panel-header">
              <h2>Identité du format</h2>
              <span className="muted">
                {draft.blocks.length} bloc(s) · {draft.connectors.length} connecteur(s) ·{' '}
                {draft.teams.length} équipe(s)
              </span>
            </header>

            <div className="format-form-grid">
              <Field label="Nom">
                <input
                  value={draft.name}
                  onChange={(event) =>
                    formatStore.updateDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Identifiant">
                <input value={draft.id} readOnly />
              </Field>
              <Field label="Graine PRNG">
                <input
                  type="number"
                  value={draft.prngSeed}
                  onChange={(event) =>
                    formatStore.updateDraft((current) => ({
                      ...current,
                      prngSeed: Number(event.target.value),
                    }))
                  }
                />
              </Field>
              <Field label="Bloc d’entrée (seeding)">
                <select
                  value={draft.entryBlockId}
                  onChange={(event) =>
                    formatStore.updateDraft((current) => ({
                      ...current,
                      entryBlockId: event.target.value,
                    }))
                  }
                >
                  {blockIds.map((id) => (
                    <option key={id} value={id}>
                      {id || '(sans identifiant)'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Description" wide>
                <textarea
                  rows={2}
                  value={draft.description ?? ''}
                  onChange={(event) =>
                    formatStore.updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <h3 className="format-section-title">Barème de points</h3>
            <div className="format-form-grid compact">
              {POINTS_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    value={draft.pointsConfig[key]}
                    onChange={(event) =>
                      formatStore.updateDraft((current) => ({
                        ...current,
                        pointsConfig: {
                          ...current.pointsConfig,
                          [key]: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
          </section>

          <div className="format-columns">
            <section className="panel">
              <header className="panel-header">
                <h2>Seeding des équipes</h2>
                <button
                  type="button"
                  className="mini"
                  onClick={() =>
                    formatStore.updateDraft((current) => {
                      const ids = current.teams.map((team) => team.id);
                      const id = uniqueId('team', ids);
                      const teams = [
                        ...current.teams,
                        { id, name: `Équipe ${current.teams.length + 1}` },
                      ] as TeamBase[];
                      return { ...current, teams: normaliseSeeds(teams) };
                    })
                  }
                >
                  + Équipe
                </button>
              </header>

              <table className="format-table">
                <thead>
                  <tr>
                    <th>Seed</th>
                    <th>Id</th>
                    <th>Nom</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.teams.map((team, index) => (
                    <tr key={index}>
                      <td className="seed-cell">
                        <select
                          value={index + 1}
                          title="Changer le numéro de seed"
                          onChange={(event) => {
                            const target = Number(event.target.value) - 1;
                            formatStore.updateDraft((current) => {
                              if (
                                !Number.isInteger(target) ||
                                target < 0 ||
                                target >= current.teams.length ||
                                target === index
                              ) {
                                return current;
                              }
                              const teams = [...current.teams];
                              const [moved] = teams.splice(index, 1);
                              teams.splice(target, 0, moved);
                              return { ...current, teams: normaliseSeeds(teams) };
                            });
                          }}
                        >
                          {draft.teams.map((_, seedIndex) => (
                            <option key={seedIndex} value={seedIndex + 1}>
                              {seedIndex + 1}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={team.id}
                          onChange={(event) =>
                            formatStore.updateDraft((current) => ({
                              ...current,
                              teams: current.teams.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, id: event.target.value } : entry,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={team.name}
                          onChange={(event) =>
                            formatStore.updateDraft((current) => ({
                              ...current,
                              teams: current.teams.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? { ...entry, name: event.target.value }
                                  : entry,
                              ),
                            }))
                          }
                        />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title="Monter"
                          disabled={index === 0}
                          onClick={() =>
                            formatStore.updateDraft((current) => {
                              const teams = [...current.teams];
                              [teams[index - 1], teams[index]] = [teams[index], teams[index - 1]];
                              return { ...current, teams: normaliseSeeds(teams) };
                            })
                          }
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Descendre"
                          disabled={index === draft.teams.length - 1}
                          onClick={() =>
                            formatStore.updateDraft((current) => {
                              const teams = [...current.teams];
                              [teams[index + 1], teams[index]] = [teams[index], teams[index + 1]];
                              return { ...current, teams: normaliseSeeds(teams) };
                            })
                          }
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Retirer l’équipe"
                          onClick={() =>
                            formatStore.updateDraft((current) => ({
                              ...current,
                              teams: normaliseSeeds(
                                current.teams.filter((_, entryIndex) => entryIndex !== index),
                              ),
                            }))
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">
                L’ordre des lignes définit le seed initial (1 = tête de série).
              </p>
            </section>

            <section className="panel">
              <header className="panel-header">
                <h2>Blocs du DAG</h2>
                <button
                  type="button"
                  className="mini"
                  onClick={() =>
                    formatStore.updateDraft((current) => {
                      const ids = current.blocks.map((block) => asString(block.config.id));
                      const id = uniqueId('bloc', ids);
                      const block: FormatBlockDefinition = {
                        blockType: 'SWISS',
                        config: { id, stageId: 'swiss', roundNumber: 1 },
                      };
                      return {
                        ...current,
                        blocks: [...current.blocks, block],
                        entryBlockId: current.entryBlockId || id,
                      };
                    })
                  }
                >
                  + Bloc
                </button>
              </header>

              <div className="format-card-list">
                {draft.blocks.map((block, index) => {
                  const config = block.config;
                  const skip =
                    (config.skipCondition as SkipConditionDSL | undefined) ?? { type: 'NEVER' };

                  return (
                    <article className="format-card" key={index}>
                      <header className="format-card-header">
                        <strong>Bloc {index + 1}</strong>
                        <span className="muted">{block.blockType}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Supprimer le bloc"
                          onClick={() =>
                            formatStore.updateDraft((current) => {
                              const removedId = asString(current.blocks[index]?.config.id);
                              const blocks = current.blocks.filter(
                                (_, blockIndex) => blockIndex !== index,
                              );
                              return {
                                ...current,
                                blocks,
                                connectors: current.connectors.filter(
                                  (connector) =>
                                    connector.sourceBlockId !== removedId &&
                                    connector.targetBlockId !== removedId,
                                ),
                                entryBlockId:
                                  current.entryBlockId === removedId
                                    ? asString(blocks[0]?.config.id)
                                    : current.entryBlockId,
                              };
                            })
                          }
                        >
                          ✕
                        </button>
                      </header>

                      <div className="format-form-grid compact">
                        <Field label="Type">
                          <select
                            value={block.blockType}
                            onChange={(event) => {
                              const type = event.target.value as FormatBlockDefinition['blockType'];
                              formatStore.updateDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((entry, blockIndex) => {
                                  if (blockIndex !== index) return entry;
                                  const nextConfig = { ...entry.config };
                                  if (type === 'ROUND_ROBIN') {
                                    nextConfig.roundIndex = asNumber(nextConfig.roundIndex, 0);
                                  } else {
                                    delete nextConfig.roundIndex;
                                  }
                                  return { ...entry, blockType: type, config: nextConfig };
                                }),
                              }));
                            }}
                          >
                            {BLOCK_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Identifiant">
                          <input
                            value={asString(config.id)}
                            onChange={(event) => {
                              const nextId = event.target.value;
                              formatStore.updateDraft((current) => {
                                const previousId = asString(current.blocks[index]?.config.id);
                                return {
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) =>
                                    blockIndex === index
                                      ? {
                                          ...entry,
                                          config: { ...entry.config, id: nextId },
                                        }
                                      : entry,
                                  ),
                                  connectors: current.connectors.map((connector) => ({
                                    ...connector,
                                    sourceBlockId:
                                      connector.sourceBlockId === previousId
                                        ? nextId
                                        : connector.sourceBlockId,
                                    targetBlockId:
                                      connector.targetBlockId === previousId
                                        ? nextId
                                        : connector.targetBlockId,
                                  })),
                                  entryBlockId:
                                    current.entryBlockId === previousId
                                      ? nextId
                                      : current.entryBlockId,
                                };
                              });
                            }}
                          />
                        </Field>
                        <Field label="Stage">
                          <input
                            value={asString(config.stageId)}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((entry, blockIndex) =>
                                  blockIndex === index
                                    ? {
                                        ...entry,
                                        config: { ...entry.config, stageId: event.target.value },
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Numéro de ronde">
                          <input
                            type="number"
                            value={asNumber(config.roundNumber, 1)}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((entry, blockIndex) =>
                                  blockIndex === index
                                    ? {
                                        ...entry,
                                        config: {
                                          ...entry.config,
                                          roundNumber: Number(event.target.value),
                                        },
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          />
                        </Field>
                        {block.blockType === 'ROUND_ROBIN' && (
                          <Field label="Journée (roundIndex)">
                            <input
                              type="number"
                              value={asNumber(config.roundIndex, 0)}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) =>
                                    blockIndex === index
                                      ? {
                                          ...entry,
                                          config: {
                                            ...entry.config,
                                            roundIndex: Number(event.target.value),
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        {block.blockType === 'BRACKET' && (
                          <Field label="Slots attendus (optionnel)">
                            <input
                              type="number"
                              min={0}
                              value={
                                config.expectedSlots === undefined
                                  ? ''
                                  : String(config.expectedSlots)
                              }
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) => {
                                    if (blockIndex !== index) return entry;
                                    const nextConfig = { ...entry.config };
                                    if (event.target.value === '') {
                                      delete nextConfig.expectedSlots;
                                    } else {
                                      nextConfig.expectedSlots = Number(event.target.value);
                                    }
                                    return { ...entry, config: nextConfig };
                                  }),
                                }))
                              }
                            />
                          </Field>
                        )}
                        <Field label="Condition de court-circuit">
                          <select
                            value={skip.type}
                            onChange={(event) => {
                              const type = event.target.value as SkipConditionDSL['type'];
                              const nextSkip = defaultSkipCondition(
                                type,
                                draft.connectors[0]?.id ?? '',
                              );
                              formatStore.updateDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((entry, blockIndex) =>
                                  blockIndex === index
                                    ? {
                                        ...entry,
                                        config: { ...entry.config, skipCondition: nextSkip },
                                      }
                                    : entry,
                                ),
                              }));
                            }}
                          >
                            {SKIP_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {skip.type === 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED' && (
                          <Field label="Connecteur surveillé">
                            <select
                              value={skip.connectorId}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) =>
                                    blockIndex === index
                                      ? {
                                          ...entry,
                                          config: {
                                            ...entry.config,
                                            skipCondition: { ...skip, connectorId: event.target.value },
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            >
                              {draft.connectors.map((connector) => (
                                <option key={connector.id} value={connector.id}>
                                  {connector.id}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}
                        {skip.type === 'SKIP_IF_FEWER_TEAMS_THAN' && (
                          <Field label="Minimum d’équipes">
                            <input
                              type="number"
                              value={skip.minTeams}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) =>
                                    blockIndex === index
                                      ? {
                                          ...entry,
                                          config: {
                                            ...entry.config,
                                            skipCondition: {
                                              ...skip,
                                              minTeams: Number(event.target.value),
                                            },
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        {skip.type === 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS' && (
                          <Field label="Victoires requises">
                            <input
                              type="number"
                              value={skip.wins}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  blocks: current.blocks.map((entry, blockIndex) =>
                                    blockIndex === index
                                      ? {
                                          ...entry,
                                          config: {
                                            ...entry.config,
                                            skipCondition: {
                                              ...skip,
                                              wins: Number(event.target.value),
                                            },
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        <Field label="Critères de classement" wide>
                          <select
                            multiple
                            value={(config.rankingCriteria as RankingCriterion[] | undefined) ?? []}
                            onChange={(event) => {
                              const selected = Array.from(
                                event.target.selectedOptions,
                                (option) => option.value as RankingCriterion,
                              );
                              formatStore.updateDraft((current) => ({
                                ...current,
                                blocks: current.blocks.map((entry, blockIndex) =>
                                  blockIndex === index
                                    ? {
                                        ...entry,
                                        config: {
                                          ...entry.config,
                                          rankingCriteria: selected,
                                        },
                                      }
                                    : entry,
                                ),
                              }));
                            }}
                          >
                            {RANKING_CRITERIA.map((criterion) => (
                              <option key={criterion} value={criterion}>
                                {criterion}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="panel">
            <header className="panel-header">
              <h2>Connecteurs</h2>
              <button
                type="button"
                className="mini"
                disabled={draft.blocks.length < 2}
                title={
                  draft.blocks.length < 2
                    ? 'Ajoutez au moins deux blocs pour créer un connecteur'
                    : undefined
                }
                onClick={() =>
                  formatStore.updateDraft((current) => {
                    const source = asString(current.blocks[0]?.config.id);
                    const target = asString(current.blocks[1]?.config.id);
                    const id = uniqueId(
                      'conn',
                      current.connectors.map((connector) => connector.id),
                    );
                    const connector: ConnectorConfig = {
                      id,
                      sourceBlockId: source,
                      targetBlockId: target,
                      transferMode: 'BATCH',
                      filterRule: { type: 'ALL' },
                      statsResetPolicy: 'KEEP_ALL',
                    };
                    return { ...current, connectors: [...current.connectors, connector] };
                  })
                }
              >
                + Connecteur
              </button>
            </header>

            {draft.connectors.length === 0 ? (
              <p className="muted">
                Aucun connecteur. Les blocs sont indépendants tant qu’aucun lien n’est défini.
              </p>
            ) : (
              <div className="format-card-list">
                {draft.connectors.map((connector, index) => {
                  const filter = connector.filterRule;
                  return (
                    <article className="format-card" key={index}>
                      <header className="format-card-header">
                        <strong>Connecteur {index + 1}</strong>
                        <span className="muted">{connector.id}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Supprimer le connecteur"
                          onClick={() =>
                            formatStore.updateDraft((current) => ({
                              ...current,
                              connectors: current.connectors.filter(
                                (_, connectorIndex) => connectorIndex !== index,
                              ),
                            }))
                          }
                        >
                          ✕
                        </button>
                      </header>

                      <div className="format-form-grid compact">
                        <Field label="Bloc source">
                          <select
                            value={connector.sourceBlockId}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? { ...entry, sourceBlockId: event.target.value }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            {blockIds.map((id) => (
                              <option key={id} value={id}>
                                {id || '(sans identifiant)'}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Bloc cible">
                          <select
                            value={connector.targetBlockId}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? { ...entry, targetBlockId: event.target.value }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            {blockIds.map((id) => (
                              <option key={id} value={id}>
                                {id || '(sans identifiant)'}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Identifiant">
                          <input
                            value={connector.id}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? { ...entry, id: event.target.value }
                                    : entry,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Mode de transfert">
                          <select
                            value={connector.transferMode}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? {
                                        ...entry,
                                        transferMode: event.target.value as TransferMode,
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            {TRANSFER_MODES.map((mode) => (
                              <option key={mode.value} value={mode.value}>
                                {mode.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Filtre">
                          <select
                            value={filter.type}
                            onChange={(event) => {
                              const rule = defaultFilterRule(
                                event.target.value as FilterRuleDSL['type'],
                              );
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? { ...entry, filterRule: rule }
                                    : entry,
                                ),
                              }));
                            }}
                          >
                            {FILTER_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {(filter.type === 'TOP_N' || filter.type === 'BOTTOM_N') && (
                          <Field label="Nombre d’équipes">
                            <input
                              type="number"
                              value={filter.count}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  connectors: current.connectors.map((entry, connectorIndex) =>
                                    connectorIndex === index
                                      ? {
                                          ...entry,
                                          filterRule: {
                                            ...filter,
                                            count: Number(event.target.value),
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        {filter.type === 'RANGE' && (
                          <>
                            <Field label="Rang de début">
                              <input
                                type="number"
                                value={filter.startRank}
                                onChange={(event) =>
                                  formatStore.updateDraft((current) => ({
                                    ...current,
                                    connectors: current.connectors.map(
                                      (entry, connectorIndex) =>
                                        connectorIndex === index
                                          ? {
                                              ...entry,
                                              filterRule: {
                                                ...filter,
                                                startRank: Number(event.target.value),
                                              },
                                            }
                                          : entry,
                                    ),
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Rang de fin">
                              <input
                                type="number"
                                value={filter.endRank}
                                onChange={(event) =>
                                  formatStore.updateDraft((current) => ({
                                    ...current,
                                    connectors: current.connectors.map(
                                      (entry, connectorIndex) =>
                                        connectorIndex === index
                                          ? {
                                              ...entry,
                                              filterRule: {
                                                ...filter,
                                                endRank: Number(event.target.value),
                                              },
                                            }
                                          : entry,
                                    ),
                                  }))
                                }
                              />
                            </Field>
                          </>
                        )}
                        {filter.type === 'MIN_POINTS' && (
                          <Field label="Points minimum">
                            <input
                              type="number"
                              value={filter.points}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  connectors: current.connectors.map((entry, connectorIndex) =>
                                    connectorIndex === index
                                      ? {
                                          ...entry,
                                          filterRule: {
                                            ...filter,
                                            points: Number(event.target.value),
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        {filter.type === 'EXACT_WINS' && (
                          <Field label="Victoires exactes">
                            <input
                              type="number"
                              value={filter.wins}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  connectors: current.connectors.map((entry, connectorIndex) =>
                                    connectorIndex === index
                                      ? {
                                          ...entry,
                                          filterRule: {
                                            ...filter,
                                            wins: Number(event.target.value),
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        {filter.type === 'EXACT_LOSSES' && (
                          <Field label="Défaites exactes">
                            <input
                              type="number"
                              value={filter.losses}
                              onChange={(event) =>
                                formatStore.updateDraft((current) => ({
                                  ...current,
                                  connectors: current.connectors.map((entry, connectorIndex) =>
                                    connectorIndex === index
                                      ? {
                                          ...entry,
                                          filterRule: {
                                            ...filter,
                                            losses: Number(event.target.value),
                                          },
                                        }
                                      : entry,
                                  ),
                                }))
                              }
                            />
                          </Field>
                        )}
                        <Field label="Transformation de seeding">
                          <select
                            value={connector.seedingTransform ?? ''}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? {
                                        ...entry,
                                        seedingTransform:
                                          event.target.value === ''
                                            ? undefined
                                            : (event.target.value as SeedingTransform),
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            <option value="">Aucune</option>
                            {SEEDING_TRANSFORMS.map((transform) => (
                              <option key={transform.value} value={transform.value}>
                                {transform.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Politique de statistiques">
                          <select
                            value={connector.statsResetPolicy}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? {
                                        ...entry,
                                        statsResetPolicy:
                                          event.target.value as StatsResetPolicy,
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          >
                            {STATS_RESET_POLICIES.map((policy) => (
                              <option key={policy.value} value={policy.value}>
                                {policy.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Stage cible (optionnel)">
                          <input
                            value={connector.targetStageId ?? ''}
                            onChange={(event) =>
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? {
                                        ...entry,
                                        targetStageId:
                                          event.target.value === ''
                                            ? undefined
                                            : event.target.value,
                                      }
                                    : entry,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field label="Critères de classement" wide>
                          <select
                            multiple
                            value={connector.rankingCriteria ?? []}
                            onChange={(event) => {
                              const selected = Array.from(
                                event.target.selectedOptions,
                                (option) => option.value as RankingCriterion,
                              );
                              formatStore.updateDraft((current) => ({
                                ...current,
                                connectors: current.connectors.map((entry, connectorIndex) =>
                                  connectorIndex === index
                                    ? {
                                        ...entry,
                                        rankingCriteria:
                                          selected.length > 0 ? selected : undefined,
                                      }
                                    : entry,
                                ),
                              }));
                            }}
                          >
                            {RANKING_CRITERIA.map((criterion) => (
                              <option key={criterion} value={criterion}>
                                {criterion}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel-header">
              <h2>Validation</h2>
              <span className={`chip${hasErrors ? ' chip-warn' : ''}`}>
                {hasErrors
                  ? `${view.issues.length} problème(s)`
                  : 'Format prêt à être enregistré'}
              </span>
            </header>
            {hasErrors ? (
              <ul className="issue-list">
                {view.issues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <code>{issue.path}</code> — {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Le format est cohérent : chaque connecteur référence des blocs existants et le
                seeding pointe vers un bloc valide. Vous pouvez l’enregistrer ou l’ouvrir
                directement dans la console.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { TournamentFormat } from '../../../src/index';
import { useFormats } from '../hooks/useFormats';
import { formatStore } from '../store/formatStore';
import { FormatBlockModal } from './format/FormatBlockModal';
import { FormatConnectorModal } from './format/FormatConnectorModal';
import {
  FormatMindmap,
  type LinkMode,
  type MindmapSelection,
} from './format/FormatMindmap';
import { Field } from './format/Field';
import {
  POINTS_FIELDS,
  asString,
  createBlock,
  createConnector,
  duplicateConnector,
  normaliseSeeds,
  removeBlock,
  removeConnector,
  uniqueId,
} from './format/formatHelpers';

interface Props {
  onOpenInConsole: (format: TournamentFormat) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR');
}

/**
 * Éditeur de formats de tournoi.
 *
 * Le DAG est présenté comme une mindmap : chaque bloc est une carte, chaque
 * connecteur une arête cliquable. Les propriétés détaillées s'éditent dans une
 * modal, et un mode « relier » permet de créer des connecteurs directement
 * depuis un bloc. Le format reste un document JSON pur, sauvegardé dans le faux
 * backend local puis instanciable dans la console.
 */
export function FormatEditor({ onOpenInConsole }: Props) {
  const view = useFormats();
  const draft = view.draft;

  const [selection, setSelection] = useState<MindmapSelection>(null);
  const [linkMode, setLinkMode] = useState<LinkMode | null>(null);

  const blockIds = draft
    ? draft.blocks.map((block) => asString(block.config.id))
    : [];
  const selectedValue = view.activeId ?? draft?.id ?? '';
  const hasErrors = view.issues.length > 0;

  // Le brouillon a changé de document : les indices de sélection ne sont plus
  // forcément valides.
  useEffect(() => {
    setSelection(null);
    setLinkMode(null);
  }, [view.activeId, view.draft?.id]);

  useEffect(() => {
    if (!linkMode) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkMode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [linkMode]);

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

  const openBlock = (index: number) => {
    setLinkMode(null);
    setSelection({ kind: 'block', index });
  };

  const openConnector = (index: number) => {
    setLinkMode(null);
    setSelection({ kind: 'connector', index });
  };

  const startLink = (sourceId: string | null = null) => {
    setSelection(null);
    setLinkMode({ sourceId });
  };

  const handleLinkTarget = (index: number) => {
    if (!draft || !linkMode) return;
    const targetId = asString(draft.blocks[index]?.config.id);
    if (!targetId) return;

    if (linkMode.sourceId === null) {
      setLinkMode({ sourceId: targetId });
      return;
    }
    if (linkMode.sourceId === targetId) return;

    const sourceId = linkMode.sourceId;
    const connectorIndex = draft.connectors.length;
    formatStore.updateDraft((current) => ({
      ...current,
      connectors: [
        ...current.connectors,
        createConnector(
          current.connectors.map((connector) => connector.id),
          sourceId,
          targetId,
        ),
      ],
    }));
    setLinkMode(null);
    setSelection({ kind: 'connector', index: connectorIndex });
  };

  const addBlock = () => {
    if (!draft) return;
    const index = draft.blocks.length;
    const id = uniqueId(
      'bloc',
      draft.blocks.map((block) => asString(block.config.id)),
    );
    formatStore.updateDraft((current) => ({
      ...current,
      blocks: [...current.blocks, createBlock(id)],
      entryBlockId: current.entryBlockId || id,
    }));
    setLinkMode(null);
    setSelection({ kind: 'block', index });
  };

  const deleteBlock = (index: number) => {
    if (!draft) return;
    const removedId = asString(draft.blocks[index]?.config.id);
    if (
      !window.confirm(
        'Supprimer ce bloc ainsi que tous les connecteurs qui le touchent ?',
      )
    ) {
      return;
    }
    formatStore.updateDraft((current) => removeBlock(current, index));
    setSelection(null);
    setLinkMode((current) =>
      current && current.sourceId === removedId ? null : current,
    );
  };

  const deleteConnector = (index: number) => {
    formatStore.updateDraft((current) => removeConnector(current, index));
    setSelection(null);
  };

  const duplicateSelectedConnector = (index: number) => {
    if (!draft) return;
    const copy = duplicateConnector(draft, index);
    if (!copy) return;
    const nextIndex = draft.connectors.length;
    formatStore.updateDraft((current) => ({
      ...current,
      connectors: [...current.connectors, structuredClone(copy)],
    }));
    setSelection({ kind: 'connector', index: nextIndex });
  };

  const setEntryBlock = (blockId: string) => {
    formatStore.updateDraft((current) => ({ ...current, entryBlockId: blockId }));
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
          <FormatMindmap
            format={draft}
            selection={selection}
            linkMode={linkMode}
            onSelectBlock={openBlock}
            onSelectConnector={openConnector}
            onStartLinkFromBlock={(blockId) => {
              if (blockId) startLink(blockId);
            }}
            onLinkTarget={handleLinkTarget}
            onCancelLink={() => setLinkMode(null)}
            onAddBlock={addBlock}
            onStartNewConnector={() => startLink(null)}
          />

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
                      ] as typeof current.teams;
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
          </div>

          {selection?.kind === 'block' && draft.blocks[selection.index] && (
            <FormatBlockModal
              format={draft}
              index={selection.index}
              onClose={() => setSelection(null)}
              onDelete={() => deleteBlock(selection.index)}
              onStartLink={(blockId) => startLink(blockId)}
              onSetEntry={setEntryBlock}
            />
          )}

          {selection?.kind === 'connector' && draft.connectors[selection.index] && (
            <FormatConnectorModal
              format={draft}
              index={selection.index}
              onClose={() => setSelection(null)}
              onDelete={() => deleteConnector(selection.index)}
              onDuplicate={() => duplicateSelectedConnector(selection.index)}
              onExtendFromTarget={(blockId) => startLink(blockId)}
            />
          )}
        </>
      )}
    </div>
  );
}

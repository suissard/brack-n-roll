import type {
  FilterRuleDSL,
  RankingCriterion,
  SeedingTransform,
  StatsResetPolicy,
  TournamentFormat,
  TransferMode,
} from '../../../../src/index';
import { formatStore } from '../../store/formatStore';
import { Modal } from './FormatModal';
import { Field } from './Field';
import {
  FILTER_TYPES,
  RANKING_CRITERIA,
  SEEDING_TRANSFORMS,
  STATS_RESET_POLICIES,
  TRANSFER_MODES,
  asString,
  defaultFilterRule,
  filterLabel,
  renameConnectorId,
} from './formatHelpers';

interface Props {
  format: TournamentFormat;
  index: number;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExtendFromTarget: (blockId: string) => void;
}

export function FormatConnectorModal({
  format,
  index,
  onClose,
  onDelete,
  onDuplicate,
  onExtendFromTarget,
}: Props) {
  const connector = format.connectors[index];
  if (!connector) return null;

  const filter = connector.filterRule;
  const blockIds = format.blocks.map((block) => asString(block.config.id));

  const patchConnector = (patch: Partial<typeof connector>) => {
    formatStore.updateDraft((current) => ({
      ...current,
      connectors: current.connectors.map((entry, connectorIndex) =>
        connectorIndex === index ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  return (
    <Modal
      wide
      title={`Connecteur · ${connector.id || 'sans identifiant'}`}
      subtitle={
        <>
          <code>{connector.sourceBlockId || '?'}</code> →{' '}
          <code>{connector.targetBlockId || '?'}</code> · {filterLabel(filter)} ·{' '}
          {connector.transferMode}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost danger" onClick={onDelete}>
            Supprimer
          </button>
          <button type="button" onClick={onDuplicate}>
            Dupliquer
          </button>
          <span className="format-modal-spacer" />
          <button type="button" onClick={onClose}>
            Fermer
          </button>
          <button
            type="button"
            className="primary"
            disabled={!connector.targetBlockId}
            title="Créer un nouveau connecteur à partir du bloc cible"
            onClick={() => onExtendFromTarget(connector.targetBlockId)}
          >
            Prolonger depuis la cible
          </button>
        </>
      }
    >
      <div className="format-form-grid compact">
        <Field label="Bloc source">
          <select
            value={connector.sourceBlockId}
            onChange={(event) => patchConnector({ sourceBlockId: event.target.value })}
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
            onChange={(event) => patchConnector({ targetBlockId: event.target.value })}
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
              formatStore.updateDraft((current) =>
                renameConnectorId(current, index, event.target.value),
              )
            }
          />
        </Field>

        <Field label="Mode de transfert">
          <select
            value={connector.transferMode}
            onChange={(event) =>
              patchConnector({ transferMode: event.target.value as TransferMode })
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
            onChange={(event) =>
              patchConnector({
                filterRule: defaultFilterRule(
                  event.target.value as FilterRuleDSL['type'],
                ),
              })
            }
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
                patchConnector({
                  filterRule: { ...filter, count: Number(event.target.value) },
                })
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
                  patchConnector({
                    filterRule: { ...filter, startRank: Number(event.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Rang de fin">
              <input
                type="number"
                value={filter.endRank}
                onChange={(event) =>
                  patchConnector({
                    filterRule: { ...filter, endRank: Number(event.target.value) },
                  })
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
                patchConnector({
                  filterRule: { ...filter, points: Number(event.target.value) },
                })
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
                patchConnector({
                  filterRule: { ...filter, wins: Number(event.target.value) },
                })
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
                patchConnector({
                  filterRule: { ...filter, losses: Number(event.target.value) },
                })
              }
            />
          </Field>
        )}

        <Field label="Transformation de seeding">
          <select
            value={connector.seedingTransform ?? ''}
            onChange={(event) =>
              patchConnector({
                seedingTransform:
                  event.target.value === ''
                    ? undefined
                    : (event.target.value as SeedingTransform),
              })
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
              patchConnector({
                statsResetPolicy: event.target.value as StatsResetPolicy,
              })
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
              patchConnector({
                targetStageId:
                  event.target.value === '' ? undefined : event.target.value,
              })
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
              patchConnector({
                rankingCriteria: selected.length > 0 ? selected : undefined,
              });
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

      <div className="format-connector-tip">
        <strong>Astuce</strong>
        <p className="muted">
          « Dupliquer » recrée un connecteur identique (utile pour un second flux
          entre les mêmes blocs). « Prolonger depuis la cible » démarre un nouveau
          lien à partir du bloc cible de celui-ci.
        </p>
      </div>
    </Modal>
  );
}

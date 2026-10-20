import type {
  RankingCriterion,
  SkipConditionDSL,
  TournamentFormat,
} from '../../../../src/index';
import { formatStore } from '../../store/formatStore';
import { Modal } from './FormatModal';
import { Field } from './Field';
import {
  BLOCK_TYPES,
  RANKING_CRITERIA,
  SKIP_TYPES,
  asNumber,
  asString,
  blockTypeLabel,
  defaultSkipCondition,
  renameBlockId,
} from './formatHelpers';

interface Props {
  format: TournamentFormat;
  index: number;
  onClose: () => void;
  onDelete: () => void;
  onStartLink: (blockId: string) => void;
  onSetEntry: (blockId: string) => void;
}

export function FormatBlockModal({
  format,
  index,
  onClose,
  onDelete,
  onStartLink,
  onSetEntry,
}: Props) {
  const block = format.blocks[index];
  if (!block) return null;

  const config = block.config;
  const blockId = asString(config.id);
  const skip = (config.skipCondition as SkipConditionDSL | undefined) ?? { type: 'NEVER' };
  const rankingCriteria = (config.rankingCriteria as RankingCriterion[] | undefined) ?? [];
  const isEntry = format.entryBlockId === blockId;
  const connectorIds = format.connectors.map((connector) => connector.id);

  const patchConfig = (patch: Record<string, unknown>) => {
    formatStore.updateDraft((current) => ({
      ...current,
      blocks: current.blocks.map((entry, blockIndex) =>
        blockIndex === index
          ? { ...entry, config: { ...entry.config, ...patch } }
          : entry,
      ),
    }));
  };

  const countForBlock = format.connectors.filter(
    (connector) =>
      connector.sourceBlockId === blockId || connector.targetBlockId === blockId,
  ).length;

  return (
    <Modal
      wide
      title={`Bloc · ${blockId || 'sans identifiant'}`}
      subtitle={
        <>
          {blockTypeLabel(block.blockType)} · {countForBlock} connecteur(s) lié(s)
          {isEntry ? ' · bloc d’entrée' : ''}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost danger" onClick={onDelete}>
            Supprimer le bloc
          </button>
          <span className="format-modal-spacer" />
          <button type="button" onClick={onClose}>
            Fermer
          </button>
          <button
            type="button"
            className="primary"
            disabled={!blockId || format.blocks.length < 2}
            title={
              format.blocks.length < 2
                ? 'Ajoutez au moins deux blocs pour créer un connecteur'
                : undefined
            }
            onClick={() => onStartLink(blockId)}
          >
            Relier ce bloc…
          </button>
        </>
      }
    >
      <div className="format-form-grid compact">
        <Field label="Type">
          <select
            value={block.blockType}
            onChange={(event) => {
              const type = event.target.value as (typeof BLOCK_TYPES)[number]['value'];
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
            value={blockId}
            onChange={(event) =>
              formatStore.updateDraft((current) =>
                renameBlockId(current, index, event.target.value),
              )
            }
          />
        </Field>

        <Field label="Stage">
          <input
            value={asString(config.stageId)}
            onChange={(event) => patchConfig({ stageId: event.target.value })}
          />
        </Field>

        <Field label="Numéro de ronde">
          <input
            type="number"
            value={asNumber(config.roundNumber, 1)}
            onChange={(event) => patchConfig({ roundNumber: Number(event.target.value) })}
          />
        </Field>

        {block.blockType === 'ROUND_ROBIN' && (
          <Field label="Journée (roundIndex)">
            <input
              type="number"
              value={asNumber(config.roundIndex, 0)}
              onChange={(event) => patchConfig({ roundIndex: Number(event.target.value) })}
            />
          </Field>
        )}

        {block.blockType === 'BRACKET' && (
          <Field label="Slots attendus (optionnel)">
            <input
              type="number"
              min={0}
              value={config.expectedSlots === undefined ? '' : String(config.expectedSlots)}
              onChange={(event) => {
                if (event.target.value === '') patchConfig({ expectedSlots: undefined });
                else patchConfig({ expectedSlots: Number(event.target.value) });
              }}
            />
          </Field>
        )}

        <Field label="Condition de court-circuit">
          <select
            value={skip.type}
            onChange={(event) => {
              const type = event.target.value as SkipConditionDSL['type'];
              patchConfig({
                skipCondition: defaultSkipCondition(type, connectorIds[0] ?? ''),
              });
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
                patchConfig({
                  skipCondition: { ...skip, connectorId: event.target.value },
                })
              }
            >
              <option value="">(aucun)</option>
              {connectorIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              {skip.connectorId && !connectorIds.includes(skip.connectorId) && (
                <option value={skip.connectorId}>{skip.connectorId} (introuvable)</option>
              )}
            </select>
          </Field>
        )}

        {skip.type === 'SKIP_IF_FEWER_TEAMS_THAN' && (
          <Field label="Minimum d’équipes">
            <input
              type="number"
              value={skip.minTeams}
              onChange={(event) =>
                patchConfig({
                  skipCondition: { ...skip, minTeams: Number(event.target.value) },
                })
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
                patchConfig({
                  skipCondition: { ...skip, wins: Number(event.target.value) },
                })
              }
            />
          </Field>
        )}

        <Field label="Critères de classement" wide>
          <select
            multiple
            value={rankingCriteria}
            onChange={(event) => {
              const selected = Array.from(
                event.target.selectedOptions,
                (option) => option.value as RankingCriterion,
              );
              patchConfig({ rankingCriteria: selected });
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

      <div className="format-entry-row">
        <div>
          <strong>Bloc d’entrée</strong>
          <p className="muted">
            Le seeding initial des équipes est injecté dans ce bloc.
          </p>
        </div>
        {isEntry ? (
          <span className="chip">Bloc d’entrée actuel</span>
        ) : (
          <button
            type="button"
            className="mini"
            disabled={!blockId}
            onClick={() => onSetEntry(blockId)}
          >
            Définir comme entrée
          </button>
        )}
      </div>
    </Modal>
  );
}

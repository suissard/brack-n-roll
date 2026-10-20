import { useEffect, useState } from 'react';
import type { EnrichedTeam } from '../../../src/index';

interface Props {
  teams: EnrichedTeam[];
  seedBlockId: string | null;
  started: boolean;
  busy: boolean;
  onReseed: (blockId: string, orderedTeamIds: string[]) => void;
}

function SeedNumberInput({
  index,
  total,
  disabled,
  onCommit,
}: {
  index: number;
  total: number;
  disabled: boolean;
  onCommit: (seed: number) => void;
}) {
  const [value, setValue] = useState(String(index + 1));

  useEffect(() => {
    setValue(String(index + 1));
  }, [index]);

  const commit = () => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      setValue(String(index + 1));
      return;
    }
    const clamped = Math.min(Math.max(parsed, 1), total);
    setValue(String(clamped));
    if (clamped !== index + 1) onCommit(clamped);
  };

  return (
    <input
      className="seed-input"
      type="number"
      min={1}
      max={total}
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setValue(String(index + 1));
          event.currentTarget.blur();
        }
      }}
      aria-label={`Seed ${index + 1}`}
      title="Changer le numéro de seed"
    />
  );
}

/**
 * Éditeur de seeding : on déplace les équipes par glisser-déposer, par les
 * flèches ou en saisissant directement un numéro de seed. Chaque modification
 * réécrit l'événement `TEAMS_SEEDED` dans la Time Machine et rejoue la suite.
 */
export function SeedingPanel({ teams, seedBlockId, started, busy, onReseed }: Props) {
  const [order, setOrder] = useState<EnrichedTeam[]>(teams);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (busy) return;
    setOrder(teams);
  }, [teams, busy]);

  const canEdit = seedBlockId !== null && order.length > 0 && !busy;

  const apply = (next: EnrichedTeam[]) => {
    setOrder(next);
    if (!seedBlockId) return;
    if (
      started &&
      !window.confirm(
        'Réécrire le seeding rejoue tout le tournoi : des résultats peuvent devenir orphelins. Continuer ?',
      )
    ) {
      setOrder(teams);
      return;
    }
    onReseed(seedBlockId, next.map((team) => team.id));
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= order.length) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    apply(next);
  };

  const changeSeed = (index: number, seed: number) => {
    move(index, Math.min(Math.max(seed, 1), order.length) - 1);
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Seeding</h2>
        <span className="muted">
          {seedBlockId
            ? `bloc d'entrée ${seedBlockId} · glisser-déposer ou numéro de seed`
            : 'aucun seeding actif'}
        </span>
      </header>

      {seedBlockId === null || order.length === 0 ? (
        <p className="empty">
          Aucune équipe seedée : chargez un scénario ou restaurez l'événement TEAMS_SEEDED.
        </p>
      ) : (
        <>
          <p className="seed-note">
            {started
              ? "Modifier le seeding réécrit TEAMS_SEEDED dans la Time Machine et rejoue tout le tournoi (Causal Replay)."
              : 'Le seeding choisi ici sera utilisé au démarrage du tournoi.'}
          </p>
          <ol className="seed-list">
            {order.map((team, index) => (
              <li
                key={team.id}
                className={`seed-row${dragIndex === index ? ' is-dragging' : ''}${
                  overIndex === index && dragIndex !== null && dragIndex !== index
                    ? ' is-drop-target'
                    : ''
                }`}
                draggable={canEdit}
                onDragStart={(event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', team.id);
                }}
                onDragOver={(event) => {
                  if (!canEdit) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOverIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null) move(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
              >
                <span className="seed-handle" title="Glisser pour réordonner">
                  ⠿
                </span>
                <SeedNumberInput
                  index={index}
                  total={order.length}
                  disabled={!canEdit}
                  onCommit={(seed) => changeSeed(index, seed)}
                />
                <span className="seed-team">
                  <span className="team-name">{team.name}</span>
                  <span className="team-id">{team.id}</span>
                </span>
                <span className="seed-actions">
                  <button
                    type="button"
                    className="mini"
                    disabled={!canEdit || index === 0}
                    onClick={() => move(index, index - 1)}
                    title="Monter"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="mini"
                    disabled={!canEdit || index === order.length - 1}
                    onClick={() => move(index, index + 1)}
                    title="Descendre"
                  >
                    ▼
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

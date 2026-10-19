import { useState } from 'react';
import type { EnrichedTeam, TournamentEvent, TournamentEventPayload } from '../../../src/index';

interface Props {
  timeline: TournamentEvent[];
  teams: Record<string, EnrichedTeam>;
  busy: boolean;
  onAmend: (eventId: string, payload: TournamentEventPayload) => void;
}

function summarize(payload: TournamentEventPayload, teams: Record<string, EnrichedTeam>): string {
  switch (payload.type) {
    case 'TOURNAMENT_INITIALIZED':
      return `Graine PRNG ${payload.prngSeed}`;
    case 'TEAMS_SEEDED':
      return `${payload.teams.length} équipes → ${payload.blockId}`;
    case 'TOURNAMENT_STARTED':
      return 'Démarrage du tournoi';
    case 'MATCH_RESULT_REPORTED': {
      const [a, b] = payload.expectedTeams;
      const nameA = teams[a]?.name ?? a;
      const nameB = teams[b]?.name ?? b;
      return `${nameA} ${payload.scores[a] ?? '?'} – ${payload.scores[b] ?? '?'} ${nameB}`;
    }
    case 'TEAM_DROPPED':
      return `Abandon de ${teams[payload.teamId]?.name ?? payload.teamId}`;
    case 'ROUND_PAIRINGS_LOCKED':
      return `Appariements figés (${payload.blockId})`;
    case 'MANUAL_SEED_OVERRIDE':
      return `Seed imposé (${payload.blockId})`;
    case 'TIE_BREAKER_RESOLVED':
      return `Tie-breaker résolu (${payload.connectorId})`;
  }
}

function AmendForm({
  event,
  teams,
  busy,
  onAmend,
}: {
  event: TournamentEvent;
  teams: Record<string, EnrichedTeam>;
  busy: boolean;
  onAmend: Props['onAmend'];
}) {
  const payload = event.payload;
  if (payload.type !== 'MATCH_RESULT_REPORTED') return null;

  const [first, second] = payload.expectedTeams;
  const [scoreFirst, setScoreFirst] = useState(String(payload.scores[first] ?? 0));
  const [scoreSecond, setScoreSecond] = useState(String(payload.scores[second] ?? 0));

  const submit = () => {
    const left = Number.parseInt(scoreFirst, 10);
    const right = Number.parseInt(scoreSecond, 10);
    if (Number.isNaN(left) || Number.isNaN(right)) return;
    onAmend(event.eventId, {
      type: 'MATCH_RESULT_REPORTED',
      blockId: payload.blockId,
      matchId: payload.matchId,
      expectedTeams: [first, second],
      scores: { [first]: left, [second]: right },
    });
  };

  return (
    <div className="amend-form">
      <span className="muted">Réécrire le résultat (rejoue les événements suivants) :</span>
      <div className="amend-row">
        <span>{teams[first]?.name ?? first}</span>
        <input type="number" value={scoreFirst} onChange={(event) => setScoreFirst(event.target.value)} />
        <span className="vs">–</span>
        <input type="number" value={scoreSecond} onChange={(event) => setScoreSecond(event.target.value)} />
        <span>{teams[second]?.name ?? second}</span>
        <button type="button" className="primary" disabled={busy} onClick={submit}>
          Réécrire
        </button>
      </div>
    </div>
  );
}

export function TimelinePanel({ timeline, teams, busy, onAmend }: Props) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);

  const events = newestFirst ? timeline.slice().reverse() : timeline;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Time Machine — journal & Causal Replay</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={newestFirst}
            onChange={(event) => setNewestFirst(event.target.checked)}
          />
          Plus récents d'abord
        </label>
      </header>

      <ol className="timeline">
        {events.map((event) => (
          <li key={event.eventId}>
            <div className="event-head">
              <span className="seq">#{event.sequenceIndex}</span>
              <span className={`chip chip-${event.payload.type.toLowerCase()}`}>
                {event.payload.type}
              </span>
              <span className="event-summary">{summarize(event.payload, teams)}</span>
              <span className="hash" title={event.stateHash}>
                {event.stateHash.slice(0, 6)}
              </span>
              {event.payload.type === 'MATCH_RESULT_REPORTED' && (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => setOpenEventId(openEventId === event.eventId ? null : event.eventId)}
                >
                  {openEventId === event.eventId ? 'Fermer' : 'Amender'}
                </button>
              )}
            </div>
            {openEventId === event.eventId && (
              <AmendForm event={event} teams={teams} busy={busy} onAmend={onAmend} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

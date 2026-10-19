import { useState } from 'react';
import type { EnrichedTeam, Match } from '../../../src/index';

interface Props {
  playable: Match[];
  allMatches: Match[];
  teams: Record<string, EnrichedTeam>;
  busy: boolean;
  onReport: (matchId: string, scoreA: number, scoreB: number, winnerOverrideId?: string | 'DRAW') => void;
}

function teamLabel(team: EnrichedTeam | undefined, fallback: string): string {
  if (!team) return fallback;
  return `#${team.currentSeed} ${team.name}`;
}

function MatchCard({
  match,
  teams,
  busy,
  onReport,
}: {
  match: Match;
  teams: Record<string, EnrichedTeam>;
  busy: boolean;
  onReport: Props['onReport'];
}) {
  const [scoreA, setScoreA] = useState('2');
  const [scoreB, setScoreB] = useState('0');

  const aId = match.slotA.type === 'RESOLVED' ? match.slotA.teamId : undefined;
  const bId = match.slotB.type === 'RESOLVED' ? match.slotB.teamId : undefined;
  const a = aId ? teams[aId] : undefined;
  const b = bId ? teams[bId] : undefined;

  const submit = () => {
    const left = Number.parseInt(scoreA, 10);
    const right = Number.parseInt(scoreB, 10);
    if (Number.isNaN(left) || Number.isNaN(right)) return;
    onReport(match.id, left, right);
  };

  const quickWin = (side: 'A' | 'B') => {
    onReport(match.id, side === 'A' ? 2 : 0, side === 'A' ? 0 : 2, side === 'A' ? aId : bId);
  };

  return (
    <div className="match-card">
      <div className="match-meta">
        <span className="chip">{match.blockId}</span>
        <span className="muted">Table {match.matchIndex + 1} · Round {match.roundNumber}</span>
      </div>
      <div className="match-teams">
        <button type="button" className="team-pick" disabled={busy} onClick={() => quickWin('A')}>
          {teamLabel(a, aId ?? '?')}
        </button>
        <div className="score-inputs">
          <input
            type="number"
            min={0}
            value={scoreA}
            onChange={(event) => setScoreA(event.target.value)}
            aria-label="Score domicile"
          />
          <span className="vs">–</span>
          <input
            type="number"
            min={0}
            value={scoreB}
            onChange={(event) => setScoreB(event.target.value)}
            aria-label="Score extérieur"
          />
        </div>
        <button type="button" className="team-pick away" disabled={busy} onClick={() => quickWin('B')}>
          {teamLabel(b, bId ?? '?')}
        </button>
      </div>
      <div className="match-actions">
        <button type="button" className="primary" disabled={busy} onClick={submit}>
          Enregistrer le score
        </button>
      </div>
    </div>
  );
}

export function MatchesPanel({ playable, allMatches, teams, busy, onReport }: Props) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? allMatches : playable;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Matchs</h2>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
          Afficher tous les matchs ({allMatches.length})
        </label>
      </header>

      {list.length === 0 ? (
        <p className="empty">
          Aucun match prêt. Lancez le tournoi ou saisissez les résultats en attente.
        </p>
      ) : (
        <div className="match-list">
          {list.map((match) =>
            match.state === 'READY' && !showAll ? (
              <MatchCard key={match.id} match={match} teams={teams} busy={busy} onReport={onReport} />
            ) : (
              <div key={match.id} className={`match-row state-${match.state.toLowerCase()}`}>
                <span className="chip">{match.blockId}</span>
                <span className="muted">T{match.matchIndex + 1}</span>
                <span>
                  {teamLabel(match.slotA.type === 'RESOLVED' ? teams[match.slotA.teamId] : undefined, 'BYE')}
                </span>
                <span className="vs">
                  {match.scoreA ?? '–'} : {match.scoreB ?? '–'}
                </span>
                <span>
                  {teamLabel(match.slotB.type === 'RESOLVED' ? teams[match.slotB.teamId] : undefined, 'BYE')}
                </span>
                <span className="badge badge-state">{match.state}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

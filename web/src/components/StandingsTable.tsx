import type { EnrichedTeam, TeamStatus } from '../../../src/index';

const STATUS_LABEL: Record<TeamStatus, string> = {
  ACTIVE: 'En course',
  CHAMPION: 'Champion',
  ELIMINATED: 'Éliminé',
  DROPPED: 'Abandon',
};

interface Props {
  standings: EnrichedTeam[];
  busy: boolean;
  onDrop: (teamId: string) => void;
}

export function StandingsTable({ standings, busy, onDrop }: Props) {
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>#</th>
          <th>Équipe</th>
          <th>Statut</th>
          <th title="Seed courant">Seed</th>
          <th title="Joués">J</th>
          <th title="Victoires">V</th>
          <th title="Nuls">N</th>
          <th title="Défaites">D</th>
          <th title="Byes">B</th>
          <th title="Points">Pts</th>
          <th title="Buchholz">Buch.</th>
          <th title="Différence de score">Diff</th>
          <th title="Série en cours">Série</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {standings.map((team, index) => (
          <tr key={team.id} className={`status-${team.status.toLowerCase()}`}>
            <td className="muted">{index + 1}</td>
            <td>
              <span className="team-name">{team.name}</span>
              <span className="team-id">{team.id}</span>
            </td>
            <td>
              <span className={`badge badge-${team.status.toLowerCase()}`}>{STATUS_LABEL[team.status]}</span>
            </td>
            <td>{team.currentSeed}</td>
            <td>{team.currentStageStats.played}</td>
            <td>{team.currentStageStats.wins}</td>
            <td>{team.currentStageStats.draws}</td>
            <td>{team.currentStageStats.losses}</td>
            <td>{team.currentStageStats.byes}</td>
            <td className="strong">{team.currentStageStats.points}</td>
            <td>{team.currentStageStats.buchholzScore}</td>
            <td>
              {team.currentStageStats.scoreDifference > 0 ? '+' : ''}
              {team.currentStageStats.scoreDifference}
            </td>
            <td>{team.currentStageStats.currentStreak}</td>
            <td>
              {team.status === 'ACTIVE' && (
                <button
                  type="button"
                  className="danger ghost"
                  disabled={busy}
                  onClick={() => onDrop(team.id)}
                  title="Déclarer l'abandon"
                >
                  Abandon
                </button>
              )}
            </td>
          </tr>
        ))}
        {standings.length === 0 && (
          <tr>
            <td colSpan={14} className="empty">
              Aucune équipe.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

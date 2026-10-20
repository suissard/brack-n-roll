import type { EnrichedTeam, TeamStats } from '../../../src/index';

interface Props {
  standings: EnrichedTeam[];
  qualificationCount?: number;
}

const STATUS_LABEL: Record<EnrichedTeam['status'], string> = {
  ACTIVE: 'En course',
  CHAMPION: 'Champion',
  ELIMINATED: 'Éliminé',
  DROPPED: 'Abandon',
};

function totalStats(team: EnrichedTeam): TeamStats {
  const stages = [...team.pastStages.map((stage) => stage.stats), team.currentStageStats];
  return stages.reduce<TeamStats>(
    (total, stats) => ({
      played: total.played + stats.played,
      wins: total.wins + stats.wins,
      losses: total.losses + stats.losses,
      draws: total.draws + stats.draws,
      byes: total.byes + stats.byes,
      points: total.points + stats.points,
      scoreFor: total.scoreFor + stats.scoreFor,
      scoreAgainst: total.scoreAgainst + stats.scoreAgainst,
      scoreDifference: total.scoreDifference + stats.scoreDifference,
      buchholzScore: stats.buchholzScore,
      currentStreak: stats.currentStreak,
    }),
    {
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      points: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDifference: 0,
      buchholzScore: 0,
      currentStreak: 0,
    },
  );
}

export function StandingsBoard({ standings, qualificationCount }: Props) {
  const hasArchivedStages = standings.some((team) => team.pastStages.length > 0);
  const rows = standings.map((team) => ({ team, stats: totalStats(team) }));

  // Tant qu'aucune statistique n'a été archivée, l'ordre du moteur fait foi.
  // Dès qu'une phase a été remise à zéro, on reclasse sur le bilan cumulé pour
  // garder un classement lisible par les spectateurs.
  if (hasArchivedStages) {
    rows.sort(
      (a, b) =>
        b.stats.points - a.stats.points ||
        b.stats.scoreDifference - a.stats.scoreDifference ||
        b.stats.wins - a.stats.wins ||
        a.team.initialSeed - b.team.initialSeed,
    );
  }

  return (
    <div className="standings-wrap">
      <table className="standings-compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Équipe</th>
            <th title="Matchs joués">J</th>
            <th title="Victoires">V</th>
            <th title="Défaites">D</th>
            <th title="Différence de score">Diff</th>
            <th title="Points cumulés">Pts</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, stats }, index) => {
            const qualified =
              qualificationCount !== undefined &&
              index < qualificationCount &&
              team.status !== 'ELIMINATED' &&
              team.status !== 'DROPPED';
            return (
              <tr
                key={team.id}
                className={`${team.status === 'CHAMPION' ? 'is-champion' : ''}${
                  team.status === 'ELIMINATED' || team.status === 'DROPPED'
                    ? ' is-out'
                    : ''
                }${qualified ? ' is-qualified' : ''}`}
              >
                <td className="rank-cell">
                  <span>{index + 1}</span>
                </td>
                <td className="team-cell">
                  <span className="seed-badge">{team.currentSeed}</span>
                  <span className="standings-team">
                    <span className="standings-name">{team.name}</span>
                    <span className="standings-id">{team.id}</span>
                  </span>
                </td>
                <td>{stats.played}</td>
                <td>{stats.wins}</td>
                <td>{stats.losses}</td>
                <td className={stats.scoreDifference > 0 ? 'positive' : stats.scoreDifference < 0 ? 'negative' : ''}>
                  {stats.scoreDifference > 0 ? '+' : ''}
                  {stats.scoreDifference}
                </td>
                <td className="points-cell">{stats.points}</td>
                <td>
                  <span className={`status-pill status-${team.status.toLowerCase()}`}>
                    {STATUS_LABEL[team.status]}
                  </span>
                </td>
              </tr>
            );
          })}
          {standings.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                Aucune équipe pour le moment.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="standings-note">
        {hasArchivedStages
          ? 'Bilan cumulé sur toutes les phases · égalités départagées par la différence, les victoires puis le seed.'
          : 'Classement officiel de la phase en cours (points, Buchholz, différence, seed).'}
      </p>
    </div>
  );
}

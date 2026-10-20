import { useEffect, useMemo, useState } from 'react';
import { MatchesPanel } from './MatchesPanel';
import { StandingsTable } from './StandingsTable';
import { TimelinePanel } from './TimelinePanel';
import { SCENARIOS, type ScenarioId } from '../store/scenarios';
import { tournamentStore, type TournamentView } from '../store/tournamentStore';

interface Props {
  view: TournamentView;
}

export function ConsoleView({ view }: Props) {
  const [scenarioChoice, setScenarioChoice] = useState<ScenarioId>(view.scenarioId);

  useEffect(() => {
    setScenarioChoice(view.scenarioId);
  }, [view.scenarioId]);

  const teamsById = useMemo(
    () => Object.fromEntries(view.teams.map((team) => [team.id, team])),
    [view.teams],
  );

  const allMatches = useMemo(
    () => view.blocks.flatMap((block) => block.matches),
    [view.blocks],
  );

  return (
    <div className="console-view">
      <section className="toolbar">
        <label className="field">
          <span>Scénario de démonstration</span>
          <select
            value={scenarioChoice}
            onChange={(event) => setScenarioChoice(event.target.value as ScenarioId)}
            disabled={view.busy}
          >
            {SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="primary"
          disabled={view.busy}
          onClick={() => void tournamentStore.loadScenario(scenarioChoice)}
        >
          Charger le scénario
        </button>

        <button
          type="button"
          disabled={view.busy || view.started}
          onClick={() => void tournamentStore.start()}
        >
          Démarrer le tournoi
        </button>

        <button
          type="button"
          className="ghost"
          disabled={view.busy}
          onClick={() => void tournamentStore.refresh()}
        >
          Recharger (DB)
        </button>

        <button
          type="button"
          className="ghost danger"
          disabled={view.busy}
          onClick={() => void tournamentStore.clearStorage()}
        >
          Vider le stockage
        </button>

        {view.busy && <span className="spinner" aria-label="Chargement" />}
      </section>

      <div className="grid">
        <section className="panel">
          <header className="panel-header">
            <h2>Classement — {view.scenarioName}</h2>
            <span className="muted">{view.teams.length} équipes</span>
          </header>
          <StandingsTable
            standings={view.standings}
            busy={view.busy}
            onDrop={(teamId) => void tournamentStore.dropTeam(teamId, 'abandon via console')}
          />
        </section>

        <MatchesPanel
          playable={view.playableMatches}
          allMatches={allMatches}
          teams={teamsById}
          busy={view.busy}
          onReport={(matchId, scoreA, scoreB, override) =>
            void tournamentStore.reportResult(matchId, scoreA, scoreB, override)
          }
        />
      </div>

      <section className="panel">
        <header className="panel-header">
          <h2>Blocs du DAG</h2>
          <span className="muted">{view.blocks.length} blocs</span>
        </header>
        <div className="blocks">
          {view.blocks.map((block) => (
            <div key={block.id} className={`block-card state-${block.state.toLowerCase()}`}>
              <div className="block-head">
                <span className="block-id">{block.id}</span>
                <span className="chip">{block.type}</span>
              </div>
              <div className="block-body">
                <span className={`badge badge-state`}>{block.state}</span>
                <span className="muted">
                  {block.matches.length} match(s) · in {block.inputTeamIds.length} / out{' '}
                  {block.outputTeamIds.length}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <TimelinePanel
        timeline={view.timeline}
        teams={teamsById}
        busy={view.busy}
        onAmend={(eventId, payload) => void tournamentStore.amendEvent(eventId, payload)}
      />
    </div>
  );
}

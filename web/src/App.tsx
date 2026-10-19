import { useEffect, useMemo, useState } from 'react';
import { StandingsTable } from './components/StandingsTable';
import { MatchesPanel } from './components/MatchesPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { useTournament } from './hooks/useTournament';
import { SCENARIOS, type ScenarioId } from './store/scenarios';
import { tournamentStore } from './store/tournamentStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleTimeString('fr-FR');
}

export function App() {
  const view = useTournament();
  const [scenarioChoice, setScenarioChoice] = useState<ScenarioId>(view.scenarioId);

  useEffect(() => {
    void tournamentStore.init();
  }, []);

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

  const champion = view.standings.find((team) => team.status === 'CHAMPION');

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Algo Tournament</h1>
          <p className="subtitle">
            Console de visualisation — moteur DAG + Time Machine (données de démo, persistance
            locale via un faux backend)
          </p>
        </div>
        <div className="header-stats">
          <span className="chip">Révision DB #{view.revision}</span>
          <span className="chip">Maj {formatDate(view.updatedAt)}</span>
          <span className="chip" title="Taille du localStorage">
            {formatBytes(view.storageBytes)}
          </span>
          <span className="chip hash" title="Hash FNV-1a de l'état">
            état {view.stateHash.slice(0, 8) || '—'}
          </span>
        </div>
      </header>

      <section className="toolbar">
        <label className="field">
          <span>Scénario</span>
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

        <button type="button" className="ghost" disabled={view.busy} onClick={() => void tournamentStore.refresh()}>
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

      {view.status === 'error' && view.error && <div className="banner error">{view.error}</div>}
      {view.error && view.status !== 'error' && <div className="banner error">{view.error}</div>}
      {view.lastRebase && (
        <div className="banner info">
          Causal Replay sur <code>{view.lastRebase.targetEventId}</code> :{' '}
          <strong>{view.lastRebase.applied}</strong> événement(s) rejoué(s),{' '}
          <strong>{view.lastRebase.orphaned}</strong> orphelin(s). Nouveau head {view.lastRebase.newHeadStateHash.slice(0, 8)}.
        </div>
      )}
      {champion && <div className="banner champion">🏆 Champion : {champion.name}</div>}

      {view.status === 'loading' ? (
        <p className="loading">Chargement du tournoi depuis le backend…</p>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

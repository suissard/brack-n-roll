import { useEffect, useState } from 'react';
import { ConsoleView } from './components/ConsoleView';
import { TournamentView } from './spectator/TournamentView';
import { useTournament } from './hooks/useTournament';
import { tournamentStore } from './store/tournamentStore';

type ViewId = 'tournament' | 'console';

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
  const [activeView, setActiveView] = useState<ViewId>('tournament');

  useEffect(() => {
    void tournamentStore.init();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            AT
          </span>
          <div className="brand-copy">
            <h1>Algo Tournament</h1>
            <p className="subtitle">
              {activeView === 'tournament'
                ? 'Matchs, tableaux et classement en direct'
                : 'Console technique · moteur DAG & Time Machine'}
            </p>
          </div>
        </div>

        <nav className="view-tabs" aria-label="Navigation principale">
          <button
            type="button"
            className={`view-tab${activeView === 'tournament' ? ' is-active' : ''}`}
            onClick={() => setActiveView('tournament')}
          >
            <span className="view-tab-dot" />
            Tournoi
          </button>
          <button
            type="button"
            className={`view-tab${activeView === 'console' ? ' is-active' : ''}`}
            onClick={() => setActiveView('console')}
          >
            <span className="view-tab-dot ghost-dot" />
            Console
          </button>
        </nav>

        {activeView === 'console' ? (
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
        ) : (
          <div className="header-stats">
            <span className="chip chip-demo">Démo locale · sans backend</span>
            <span className="chip">Maj {formatDate(view.updatedAt)}</span>
          </div>
        )}
      </header>

      {view.status === 'error' && view.error && <div className="banner error">{view.error}</div>}
      {view.error && view.status !== 'error' && <div className="banner error">{view.error}</div>}
      {activeView === 'console' && view.lastRebase && (
        <div className="banner info">
          Causal Replay sur <code>{view.lastRebase.targetEventId}</code> :{' '}
          <strong>{view.lastRebase.applied}</strong> événement(s) rejoué(s),{' '}
          <strong>{view.lastRebase.orphaned}</strong> orphelin(s). Nouveau head{' '}
          {view.lastRebase.newHeadStateHash.slice(0, 8)}.
        </div>
      )}

      {view.status === 'loading' ? (
        <p className="loading">Chargement du tournoi depuis le backend…</p>
      ) : activeView === 'tournament' ? (
        <TournamentView view={view} onStart={() => void tournamentStore.start()} />
      ) : (
        <ConsoleView view={view} />
      )}
    </div>
  );
}

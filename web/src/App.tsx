import { useEffect, useState } from 'react';
import logo from './assets/logo-brack-n-roll.png';
import { ConsoleView } from './components/ConsoleView';
import { FormatEditor } from './components/FormatEditor';
import { TournamentView } from './spectator/TournamentView';
import { useFormats } from './hooks/useFormats';
import { useTournament } from './hooks/useTournament';
import { formatStore } from './store/formatStore';
import { tournamentStore } from './store/tournamentStore';

type ViewId = 'tournament' | 'console' | 'formats';

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
  const formats = useFormats();
  const [activeView, setActiveView] = useState<ViewId>('tournament');

  useEffect(() => {
    void tournamentStore.init();
    void formatStore.init();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src={logo} alt="Logo Brack'n'Roll" aria-hidden="true" />
          <div className="brand-copy">
            <h1>Brack'n'Roll</h1>
            <p className="subtitle">
              {activeView === 'tournament'
                ? 'Matchs, tableaux et classement en direct'
                : activeView === 'console'
                  ? 'Console technique · moteur DAG & Time Machine'
                  : 'Éditeur de formats · blocs, connecteurs et seeding'}
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
          <button
            type="button"
            className={`view-tab${activeView === 'formats' ? ' is-active' : ''}`}
            onClick={() => setActiveView('formats')}
          >
            <span className="view-tab-dot formats-dot" />
            Formats
          </button>
        </nav>

        {activeView === 'formats' ? (
          <div className="header-stats">
            <span className="chip">{formats.storageCount} format(s) local(aux)</span>
            <span className="chip">Révision DB #{formats.revision}</span>
            <span className="chip">Maj {formatDate(formats.updatedAt)}</span>
            <span className="chip" title="Taille du localStorage des formats">
              {formatBytes(formats.storageBytes)}
            </span>
          </div>
        ) : activeView === 'console' ? (
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

      {activeView !== 'formats' && view.status === 'error' && view.error && (
        <div className="banner error">{view.error}</div>
      )}
      {activeView !== 'formats' && view.error && view.status !== 'error' && (
        <div className="banner error">{view.error}</div>
      )}
      {activeView === 'console' && view.lastRebase && (
        <div className="banner info">
          {view.lastRebase.action === 'amend' && (
            <>
              Causal Replay sur <code>{view.lastRebase.targetEventId}</code> :{' '}
            </>
          )}
          {view.lastRebase.action === 'delete' && (
            <>
              Ligne <code>{view.lastRebase.targetEventId}</code> supprimée :{' '}
            </>
          )}
          {view.lastRebase.action === 'rewind' && (
            <>
              Retour en arrière après <code>{view.lastRebase.targetEventId}</code> :{' '}
            </>
          )}
          {view.lastRebase.action === 'reseed' && (
            <>
              Seeding réécrit (<code>{view.lastRebase.targetEventId}</code>) :{' '}
            </>
          )}
          <strong>{view.lastRebase.applied}</strong> événement(s) rejoué(s),{' '}
          <strong>{view.lastRebase.orphaned}</strong> orphelin(s),{' '}
          <strong>{view.lastRebase.removed}</strong> retiré(s). Nouveau head{' '}
          {view.lastRebase.newHeadStateHash.slice(0, 8)}.
          {view.lastRebase.reasons.length > 0 && (
            <ul className="rebase-reasons">
              {[...new Set(view.lastRebase.reasons)].map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeView === 'formats' ? (
        <FormatEditor
          onOpenInConsole={(format) => {
            void (async () => {
              await tournamentStore.loadFormat(format);
              setActiveView('console');
            })();
          }}
        />
      ) : view.status === 'loading' ? (
        <p className="loading">Chargement du tournoi depuis le backend…</p>
      ) : activeView === 'tournament' ? (
        <TournamentView view={view} onStart={() => void tournamentStore.start()} />
      ) : (
        <ConsoleView view={view} />
      )}
    </div>
  );
}

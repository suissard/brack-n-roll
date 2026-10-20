import { useMemo } from 'react';
import type { ConnectorConfig, EnrichedTeam, Match } from '../../../src/index';
import type { BlockView, TournamentView as TournamentViewState } from '../store/tournamentStore';
import { BracketBoard } from './BracketBoard';
import { MatchCard } from './MatchCard';
import { RoundsBoard } from './RoundsBoard';
import { StandingsBoard } from './StandingsBoard';
import type { DisplayMatch } from '../spectator/bracketLayout';
import {
  blockStateLabel,
  buildStages,
  formatInfo,
  formatTime,
  isBlockDone,
  plural,
  prettyStageLabel,
  stageStatus,
  type StageGroup,
} from '../spectator/model';

interface Props {
  view: TournamentViewState;
  onStart: () => void;
}

interface SpotlightResult {
  match: Match;
  block: BlockView;
}

export function TournamentView({ view, onStart }: Props) {
  const teams = useMemo(
    () => Object.fromEntries(view.teams.map((team) => [team.id, team])),
    [view.teams],
  );
  const stages = useMemo(
    () => buildStages(view.blocks, view.connectors),
    [view.blocks, view.connectors],
  );
  const format = useMemo(
    () => formatInfo(view.blocks, view.connectors),
    [view.blocks, view.connectors],
  );

  const allMatches = useMemo(
    () => view.blocks.flatMap((block) => block.matches),
    [view.blocks],
  );
  const matchBlock = useMemo(() => {
    const map = new Map<string, BlockView>();
    for (const block of view.blocks) {
      for (const match of block.matches) map.set(match.id, block);
    }
    return map;
  }, [view.blocks]);

  const completedMatches = allMatches.filter((match) => match.state === 'COMPLETED');
  const allDone = view.blocks.length > 0 && view.blocks.every(isBlockDone);
  const playableCount = view.playableMatches.length;
  const liveMatches = view.playableMatches.slice(0, 3);
  const nextMatches = allMatches
    .filter((match) => match.state === 'WAITING_FOR_SLOTS')
    .slice(0, 3);
  const spotlight = (liveMatches.length > 0 ? liveMatches : nextMatches)
    .map((match) => {
      const block = matchBlock.get(match.id);
      return block ? toDisplay(match, block) : null;
    })
    .filter((display): display is DisplayMatch => display !== null)
    .slice(0, 3);

  const recentResults = useMemo<SpotlightResult[]>(() => {
    const seen = new Set<string>();
    const results: SpotlightResult[] = [];
    for (let index = view.timeline.length - 1; index >= 0; index--) {
      const event = view.timeline[index];
      if (event.payload.type !== 'MATCH_RESULT_REPORTED') continue;
      const payload = event.payload;
      if (seen.has(payload.matchId)) continue;
      const block = matchBlock.get(payload.matchId);
      const match = block?.matches.find((candidate) => candidate.id === payload.matchId);
      if (!block || !match) continue;
      seen.add(match.id);
      results.push({ match, block });
      if (results.length >= 4) break;
    }
    return results;
  }, [view.timeline, matchBlock]);

  const doneBlocks = view.blocks.filter(isBlockDone).length;
  const progress = view.blocks.length > 0 ? (doneBlocks / view.blocks.length) * 100 : 0;
  const champion = view.standings.find((team) => team.status === 'CHAMPION');
  const activeTeams = view.standings.filter(
    (team) => team.status === 'ACTIVE' || team.status === 'CHAMPION',
  ).length;
  const liveStages = stages.filter((stage) => stageStatus(stage) === 'live');
  const currentStage =
    liveStages[0] ??
    stages.find((stage) => stageStatus(stage) === 'upcoming') ??
    stages[stages.length - 1];

  const focusBlock = currentStage?.blocks.find((block) => !isBlockDone(block));
  const status = champion || allDone
    ? 'Terminé'
    : view.started
      ? 'En cours'
      : 'À venir';
  const qualificationCount = findQualificationCount(view.connectors, view.blocks);

  if (view.blocks.length === 0) {
    return (
      <div className="board-empty large">
        <span className="board-empty-icon">◇</span>
        <p>Aucun tournoi chargé pour le moment.</p>
      </div>
    );
  }

  return (
    <div className={`spectator-view tone-${format.tone}`}>
      <section className="hero">
        <div className="hero-main">
          <div className="hero-topline">
            <span className={`live-status status-${status.toLowerCase().replace(' ', '-')}`}>
              <span className="live-dot" />
              {status}
            </span>
            <span className="format-badge">{format.label}</span>
            <span className="hero-updated">Maj {formatTime(view.updatedAt)}</span>
          </div>

          <h1 className="hero-title">{view.scenarioName}</h1>
          <p className="hero-description">{format.description}</p>

          <div className="hero-facts">
            <span>
              <strong>{view.teams.length}</strong> équipes
            </span>
            <span>
              <strong>{stages.length}</strong> {plural(stages.length, 'phase')}
            </span>
            <span>
              <strong>{view.blocks.length}</strong> {plural(view.blocks.length, 'étape')}
            </span>
            {qualificationCount !== undefined && (
              <span>
                <strong>{qualificationCount}</strong> qualifiés
              </span>
            )}
          </div>

          {champion ? (
            <div className="hero-champion">
              <span className="champion-trophy">🏆</span>
              <div>
                <span className="champion-kicker">Champion du tournoi</span>
                <strong>{champion.name}</strong>
              </div>
            </div>
          ) : (
            <div className="hero-focus">
              <span className="focus-kicker">À suivre</span>
              <strong>
                {currentStage?.label ?? 'Tournoi'}
                {focusBlock
                  ? ` · ${roundTitle(currentStage, focusBlock)}`
                  : view.started
                    ? ' · phase terminée'
                    : ' · en attente du démarrage'}
              </strong>
              {!view.started && (
                <button
                  type="button"
                  className="primary hero-start"
                  disabled={view.busy}
                  onClick={onStart}
                >
                  Démarrer le tournoi
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="hero-side">
          <div className="hero-stats">
            <div className="stat-card">
              <span className="stat-value">
                {activeTeams}
                <small>/{view.teams.length}</small>
              </span>
              <span className="stat-label">encore en course</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{completedMatches.length}</span>
              <span className="stat-label">matchs joués</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">
                {doneBlocks}
                <small>/{view.blocks.length}</small>
              </span>
              <span className="stat-label">étapes terminées</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{playableCount}</span>
              <span className="stat-label">matchs prêts</span>
            </div>
          </div>
          <div className="hero-progress">
            <div className="progress-label">
              <span>Progression du tournoi</span>
              <strong>{Math.round(progress)}%</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </aside>
      </section>

      <nav className="phase-nav" aria-label="Phases du tournoi">
        {stages.map((stage, index) => {
          const status = stageStatus(stage);
          const isActive = stage.id === currentStage?.id;
          return (
            <a
              key={stage.id}
              href={`#stage-${slug(stage.id)}`}
              className={`phase-step ${status}${isActive ? ' is-active' : ''}`}
            >
              <span className="phase-number">{index + 1}</span>
              <span className="phase-copy">
                <span className="phase-name">{stage.label}</span>
                <span className="phase-meta">
                  {stage.blocks.filter(isBlockDone).length}/{stage.blocks.length} étapes
                </span>
              </span>
            </a>
          );
        })}
      </nav>

      <section className="spotlight">
        <div className="spotlight-main">
          <header className="section-head">
            <div>
              <span className="section-kicker">
                {allDone
                  ? 'Fin du tournoi'
                  : liveMatches.length > 0
                    ? 'Sur le pont'
                    : 'Prochains matchs'}
              </span>
              <h2>
                {allDone
                  ? 'Tous les matchs sont joués'
                  : liveMatches.length > 0
                    ? 'Matchs à suivre'
                    : 'À venir'}
              </h2>
            </div>
            <span className="section-note">
              {allDone
                ? champion
                  ? `Champion : ${champion.name}`
                  : `${completedMatches.length} matchs au total`
                : playableCount > 0
                  ? `${playableCount} match${playableCount > 1 ? 's' : ''} prêt${
                      playableCount > 1 ? 's' : ''
                    }`
                  : 'Aucun match immédiatement jouable'}
            </span>
          </header>
          {spotlight.length > 0 ? (
            <div className="spotlight-grid">
              {spotlight.map((display) => (
                <MatchCard
                  key={display.key}
                  display={display}
                  teams={teams}
                  showTable
                />
              ))}
            </div>
          ) : (
            <div className="spotlight-empty">
              {allDone
                ? 'Le tournoi est terminé. Le classement final est disponible ci-dessous.'
                : recentResults.length > 0
                  ? 'Tous les matchs en cours sont terminés. La suite apparaîtra après validation.'
                  : 'Le tournoi attend son lancement.'}
            </div>
          )}
        </div>

        <aside className="recent-card">
          <header className="section-head compact">
            <div>
              <span className="section-kicker">Fil des résultats</span>
              <h2>Derniers résultats</h2>
            </div>
          </header>
          {recentResults.length === 0 ? (
            <p className="muted small">Aucun résultat enregistré.</p>
          ) : (
            <ol className="recent-list">
              {recentResults.map(({ match, block }) => (
                <RecentResult key={match.id} match={match} block={block} teams={teams} />
              ))}
            </ol>
          )}
        </aside>
      </section>

      {stages.map((stage, index) => (
        <StageSection
          key={stage.id}
          stage={stage}
          index={index}
          allBlocks={view.blocks}
          allConnectors={view.connectors}
          teams={teams}
        />
      ))}

      <section className="panel standings-panel" id="classement">
        <header className="section-head">
          <div>
            <span className="section-kicker">Vue d’ensemble</span>
            <h2>Classement général</h2>
          </div>
          <span className="section-note">
            {view.standings.length} équipe{view.standings.length > 1 ? 's' : ''}
          </span>
        </header>
        <StandingsBoard
          standings={view.standings}
          qualificationCount={qualificationCount}
        />
      </section>
    </div>
  );
}

function StageSection({
  stage,
  index,
  allBlocks,
  allConnectors,
  teams,
}: {
  stage: StageGroup;
  index: number;
  allBlocks: BlockView[];
  allConnectors: ConnectorConfig[];
  teams: Record<string, EnrichedTeam>;
}) {
  const status = stageStatus(stage);
  const done = stage.blocks.filter(isBlockDone).length;
  const target = qualificationTarget(stage, allBlocks, allConnectors);

  return (
    <section className={`stage-section stage-${status}`} id={`stage-${slug(stage.id)}`}>
      <header className="stage-head">
        <div className="stage-heading">
          <span className="stage-index">Phase {index + 1}</span>
          <h2>{stage.label}</h2>
          <span className="stage-sub">
            {stage.blocks.length} {plural(stage.blocks.length, 'étape')} · {done} terminée
            {done > 1 ? 's' : ''}
            {target ? ` · ${target}` : ''}
          </span>
        </div>
        <span className={`stage-state ${status}`}>
          {status === 'live' && <span className="live-dot" />}
          {status === 'done' ? 'Terminée' : status === 'live' ? 'En cours' : 'À venir'}
        </span>
      </header>

      {stage.kind === 'bracket' ? (
        <BracketBoard
          stage={stage}
          allBlocks={allBlocks}
          allConnectors={allConnectors}
          teams={teams}
        />
      ) : stage.kind === 'swiss' || stage.kind === 'round-robin' ? (
        <RoundsBoard stage={stage} teams={teams} />
      ) : stage.kind === 'merger' ? (
        <div className="board-empty">
          <span className="board-empty-icon">⇄</span>
          <p>Phase de synchronisation : les équipes sont réordonnées avant la suite.</p>
        </div>
      ) : (
        <div className="mixed-stage">
          {groupByType(stage.blocks).map((group) => {
            const kind =
              group.type === 'SWISS'
                ? 'swiss'
                : group.type === 'ROUND_ROBIN'
                  ? 'round-robin'
                  : group.type === 'BRACKET'
                    ? 'bracket'
                    : 'mixed';
            return (
              <div key={group.type} className="mixed-group">
                <h3>{typeLabel(group.type)}</h3>
                {group.type === 'BRACKET' ? (
                  <BracketBoard
                    stage={{ blocks: group.blocks, connectors: stage.connectors }}
                    allBlocks={allBlocks}
                    allConnectors={allConnectors}
                    teams={teams}
                  />
                ) : (
                  <RoundsBoard
                    stage={{ ...stage, kind, blocks: group.blocks }}
                    teams={teams}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecentResult({
  match,
  block,
  teams,
}: {
  match: Match;
  block: BlockView;
  teams: Record<string, EnrichedTeam>;
}) {
  const a =
    match.slotA.type === 'RESOLVED'
      ? teams[match.slotA.teamId]?.name ?? match.slotA.teamId
      : '?';
  const b =
    match.slotB.type === 'RESOLVED'
      ? teams[match.slotB.teamId]?.name ?? match.slotB.teamId
      : '?';
  const aWon = match.winnerId === (match.slotA.type === 'RESOLVED' ? match.slotA.teamId : '');
  const bWon = match.winnerId === (match.slotB.type === 'RESOLVED' ? match.slotB.teamId : '');
  return (
    <li className="recent-row">
      <span className="recent-round">
        {prettyStageLabel(block.stageId)} · {block.roundNumber}
      </span>
      <span className={`recent-team${aWon ? ' won' : ''}`}>{a}</span>
      <span className="recent-score">
        {match.scoreA ?? '–'}–{match.scoreB ?? '–'}
      </span>
      <span className={`recent-team right${bWon ? ' won' : ''}`}>{b}</span>
    </li>
  );
}

function qualificationTarget(
  stage: StageGroup,
  allBlocks: BlockView[],
  allConnectors: ConnectorConfig[],
): string | null {
  const blockIds = new Set(stage.blocks.map((block) => block.id));
  const outgoing = allConnectors.filter(
    (connector) => blockIds.has(connector.sourceBlockId) && !blockIds.has(connector.targetBlockId),
  );
  if (outgoing.length === 0) return null;
  const blocksById = new Map(allBlocks.map((block) => [block.id, block]));
  const targetBlock = blocksById.get(outgoing[0].targetBlockId);
  const target = targetBlock ? prettyStageLabel(targetBlock.stageId) : 'la suite';
  const rule = outgoing[0].filterRule;
  if (rule.type === 'TOP_N') return `Top ${rule.count} vers ${target}`;
  if (rule.type === 'WINNERS') return `Vainqueurs vers ${target}`;
  if (rule.type === 'BOTTOM_N') return `Bas de tableau vers ${target}`;
  return `Qualification vers ${target}`;
}

function findQualificationCount(
  connectors: ConnectorConfig[],
  blocks: BlockView[],
): number | undefined {
  const bracketIds = new Set(
    blocks.filter((block) => block.type === 'BRACKET').map((block) => block.id),
  );
  for (const connector of connectors) {
    if (connector.filterRule.type !== 'TOP_N') continue;
    if (bracketIds.has(connector.targetBlockId)) return connector.filterRule.count;
  }
  return undefined;
}

function toDisplay(match: Match, block: BlockView): DisplayMatch {
  return {
    key: `${block.id}:${match.matchIndex}`,
    blockId: block.id,
    block,
    match,
    projected: false,
    roundLabel: '',
    matchIndex: match.matchIndex,
  };
}

function roundTitle(stage: StageGroup | undefined, block: BlockView): string {
  if (!stage) return `Tour ${block.roundNumber}`;
  if (stage.kind === 'round-robin') return `Journée ${block.roundNumber}`;
  if (stage.kind === 'swiss') return `Ronde ${block.roundNumber}`;
  return `Tour ${block.roundNumber} · ${blockStateLabel(block.state)}`;
}

function groupByType(blocks: BlockView[]): Array<{ type: string; blocks: BlockView[] }> {
  const groups = new Map<string, BlockView[]>();
  for (const block of blocks) {
    const list = groups.get(block.type) ?? [];
    list.push(block);
    groups.set(block.type, list);
  }
  return [...groups.entries()].map(([type, list]) => ({ type, blocks: list }));
}

function typeLabel(type: string): string {
  if (type === 'BRACKET') return 'Tableau';
  if (type === 'SWISS') return 'Rondes suisses';
  if (type === 'ROUND_ROBIN') return 'Toutes rondes';
  return type;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
}

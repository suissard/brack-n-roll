import type { EnrichedTeam, Match, ParticipantSlot } from '../../../src/index';
import type { DisplayMatch } from '../spectator/bracketLayout';
import { matchScore, resultLabel, winnerSide } from '../spectator/model';

interface Props {
  display: DisplayMatch;
  teams: Record<string, EnrichedTeam>;
  pointerLabels?: Map<string, string>;
  compact?: boolean;
  showTable?: boolean;
}

function resolvedName(
  slot: ParticipantSlot,
  teams: Record<string, EnrichedTeam>,
  pointerLabels: Map<string, string> | undefined,
): { name: string; seed: number | null; pending: boolean; bye: boolean } {
  if (slot.type === 'BYE') {
    return { name: 'Exempt', seed: null, pending: false, bye: true };
  }
  if (slot.type === 'RESOLVED') {
    const team = teams[slot.teamId];
    return {
      name: team?.name ?? slot.teamId,
      seed: team?.currentSeed ?? null,
      pending: false,
      bye: false,
    };
  }

  const label = pointerLabels?.get(slot.sourceMatchId);
  if (!label && slot.sourceMatchId.endsWith(':qualifier')) {
    return { name: 'Qualifié à désigner', seed: null, pending: true, bye: false };
  }
  const action = slot.outcome === 'LOSER' ? 'Perdant' : 'Vainqueur';
  return {
    name: label ? `${action} ${label}` : 'En attente',
    seed: null,
    pending: true,
    bye: false,
  };
}

function stateClass(match: Match, projected: boolean): string {
  if (projected) return 'queued';
  if (match.state === 'COMPLETED') return 'done';
  if (match.state === 'READY') return 'ready';
  if (match.state === 'SKIPPED') return 'skipped';
  return 'queued';
}

function statusLabel(match: Match, projected: boolean): string {
  if (projected) return 'À venir';
  if (match.state === 'READY') return 'Prêt à jouer';
  if (match.state === 'WAITING_FOR_SLOTS') return 'En attente';
  if (match.state === 'SKIPPED') return 'Non joué';
  return resultLabel(match);
}

export function MatchCard({ display, teams, pointerLabels, compact, showTable }: Props) {
  const { match, projected } = display;
  const side = winnerSide(match);
  const score = matchScore(match);
  const a = resolvedName(match.slotA, teams, pointerLabels);
  const b = resolvedName(match.slotB, teams, pointerLabels);
  const status = stateClass(match, projected);
  const matchNumber = match.matchIndex + 1;

  return (
    <article
      className={`match-tile state-${status}${compact ? ' compact' : ''}${
        projected ? ' projected' : ''
      }`}
      aria-label={`${a.name} contre ${b.name}`}
    >
      <div className="tile-teams">
        <div
          className={`tile-team${side === 'A' ? ' is-winner' : ''}${
            side === 'B' ? ' is-loser' : ''
          }${a.pending ? ' is-pending' : ''}${a.bye ? ' is-bye' : ''}`}
        >
          <span className="tile-seed">{a.seed ?? '·'}</span>
          <span className="tile-name" title={a.name}>
            {a.name}
          </span>
          <span className="tile-score">{score.a}</span>
        </div>
        <div
          className={`tile-team${side === 'B' ? ' is-winner' : ''}${
            side === 'A' ? ' is-loser' : ''
          }${b.pending ? ' is-pending' : ''}${b.bye ? ' is-bye' : ''}`}
        >
          <span className="tile-seed">{b.seed ?? '·'}</span>
          <span className="tile-name" title={b.name}>
            {b.name}
          </span>
          <span className="tile-score">{score.b}</span>
        </div>
      </div>
      <footer className="tile-foot">
        <span className={`tile-status ${status}`}>
          {status === 'ready' && <span className="live-dot" />}
          {statusLabel(match, projected)}
        </span>
        {showTable !== false && (
          <span className="tile-table">
            {display.block.type === 'BRACKET' ? 'Match' : 'Table'} {matchNumber}
          </span>
        )}
      </footer>
    </article>
  );
}

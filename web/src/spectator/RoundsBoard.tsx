import type { EnrichedTeam } from '../../../src/index';
import type { BlockView } from '../store/tournamentStore';
import type { DisplayMatch } from '../spectator/bracketLayout';
import {
  blockStateLabel,
  isBlockDone,
  stageRoundLabel,
  type StageGroup,
} from '../spectator/model';
import { MatchCard } from './MatchCard';

interface Props {
  stage: StageGroup;
  teams: Record<string, EnrichedTeam>;
}

export function RoundsBoard({ stage, teams }: Props) {
  const blocks = stage.blocks
    .slice()
    .sort((a, b) => a.roundNumber - b.roundNumber);
  const currentBlock = blocks.find((block) => !isBlockDone(block));

  return (
    <div className="rounds-scroll">
      <div className="rounds-board">
        {blocks.map((block) => {
          const displays: DisplayMatch[] = block.matches
            .slice()
            .sort((a, b) => a.matchIndex - b.matchIndex)
            .map((match) => ({
              key: `${block.id}:${match.matchIndex}`,
              blockId: block.id,
              block,
              match,
              projected: false,
              roundLabel: stageRoundLabel(stage, block),
              matchIndex: match.matchIndex,
            }));
          const done = displays.filter(
            (display) =>
              display.match.state === 'COMPLETED' || display.match.state === 'SKIPPED',
          ).length;
          const isCurrent = currentBlock?.id === block.id;

          return (
            <section
              key={block.id}
              className={`round-column${isCurrent ? ' is-current' : ''}${
                isBlockDone(block) ? ' is-done' : ''
              }`}
            >
              <header className="round-head">
                <div>
                  <span className="round-kicker">{roundKicker(stage)}</span>
                  <h3 className="round-title">{roundTitle(stage, block)}</h3>
                </div>
                <span className={`round-pill${isCurrent ? ' live' : ''}`}>
                  {isCurrent && <span className="live-dot" />}
                  {blockStateLabel(block.state)}
                </span>
              </header>

              <div className="round-matches">
                {displays.length === 0 ? (
                  <div className="round-empty">
                    <span className="round-empty-mark">···</span>
                    <p>
                      {block.state === 'SKIPPED'
                        ? 'Ronde non jouée.'
                        : 'Les appariements apparaîtront ici.'}
                    </p>
                  </div>
                ) : (
                  displays.map((display) => (
                    <MatchCard
                      key={display.key}
                      display={display}
                      teams={teams}
                      showTable
                    />
                  ))
                )}
              </div>

              <footer className="round-foot">
                <span>
                  {displays.length === 0
                    ? 'En attente des appariements'
                    : `${done}/${displays.length} match${
                        displays.length > 1 ? 's' : ''
                      } joué${displays.length > 1 ? 's' : ''}`}
                </span>
                <div className="round-meter" aria-hidden="true">
                  <span
                    style={{
                      width: displays.length
                        ? `${Math.round((done / displays.length) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function roundTitle(stage: StageGroup, block: BlockView): string {
  if (stage.kind === 'round-robin') return `Journée ${block.roundNumber}`;
  if (stage.kind === 'swiss') return `Ronde ${block.roundNumber}`;
  return `Tour ${block.roundNumber}`;
}

function roundKicker(stage: StageGroup): string {
  if (stage.kind === 'round-robin') return 'Journée';
  if (stage.kind === 'swiss') return 'Ronde';
  return 'Tour';
}

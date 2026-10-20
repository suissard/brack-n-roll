import { useMemo } from 'react';
import type { ConnectorConfig, EnrichedTeam } from '../../../src/index';
import type { BlockView } from '../store/tournamentStore';
import {
  bracketPointerLabels,
  BRACKET_CARD_HEIGHT,
  BRACKET_CARD_WIDTH,
  buildBracketLayout,
  type BracketEdge,
} from '../spectator/bracketLayout';
import { MatchCard } from './MatchCard';

interface Props {
  stage: { blocks: BlockView[]; connectors: ConnectorConfig[] };
  allBlocks: BlockView[];
  allConnectors: ConnectorConfig[];
  teams: Record<string, EnrichedTeam>;
}

function edgePath(edge: BracketEdge): string {
  const { from, to } = edge;
  const forward = to.x - from.x;
  if (forward > 34) {
    const control = Math.max(28, forward * 0.46);
    return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${
      to.x - control
    } ${to.y}, ${to.x} ${to.y}`;
  }
  const detour = Math.max(from.x, to.x) + 44;
  return `M ${from.x} ${from.y} C ${detour} ${from.y}, ${detour} ${to.y}, ${to.x} ${to.y}`;
}

export function BracketBoard({ stage, allBlocks, allConnectors, teams }: Props) {
  const layout = useMemo(
    () => buildBracketLayout(stage.blocks, allBlocks, allConnectors),
    [stage, allBlocks, allConnectors],
  );
  const pointerLabels = useMemo(() => bracketPointerLabels(layout), [layout]);

  if (layout.matches.length === 0) {
    return (
      <div className="board-empty">
        <span className="board-empty-icon">◇</span>
        <p>Le tableau se construira dès que les qualifiés seront connus.</p>
      </div>
    );
  }

  return (
    <div className="bracket-scroll">
      <div
        className="bracket-canvas"
        style={{ width: layout.width, height: layout.height }}
      >
        {layout.lanes.map((lane) => (
          <section
            key={lane.id}
            className={`bracket-lane lane-${lane.id}`}
            style={{ top: lane.top, height: lane.height }}
          >
            <header className="bracket-lane-head">
              <span className="bracket-lane-label">{lane.label}</span>
              <span className="bracket-lane-hint">{lane.hint}</span>
            </header>
            {lane.columns.map((column) => (
              <span
                key={column.key}
                className="bracket-col-label"
                style={{ left: column.x }}
              >
                {column.label}
              </span>
            ))}
          </section>
        ))}

        <svg
          className="bracket-lines"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => (
            <path
              key={edge.key}
              d={edgePath(edge)}
              className={`bracket-edge edge-${edge.tone}`}
            />
          ))}
        </svg>

        {layout.matches.map((match) => (
          <div
            key={match.key}
            className="bracket-card"
            style={{
              left: match.x,
              top: match.y,
              width: BRACKET_CARD_WIDTH,
              height: BRACKET_CARD_HEIGHT,
            }}
          >
            <MatchCard
              display={match}
              teams={teams}
              pointerLabels={pointerLabels}
              compact
            />
          </div>
        ))}
      </div>
    </div>
  );
}

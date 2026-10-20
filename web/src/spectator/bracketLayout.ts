import type { ConnectorConfig, Match, ParticipantSlot } from '../../../src/index';
import type { BlockView } from '../store/tournamentStore';
import { knockoutColumnLabel, participantIds, shortRoundLabel } from './model';

export const BRACKET_CARD_WIDTH = 238;
export const BRACKET_COLUMN_GAP = 58;
export const BRACKET_CARD_HEIGHT = 82;
export const BRACKET_CARD_GAP = 16;
export const BRACKET_LANE_GAP = 30;
export const BRACKET_LANE_HEADER = 62;
const BRACKET_PADDING = 10;

export interface DisplayMatch {
  key: string;
  blockId: string;
  block: BlockView;
  match: Match;
  projected: boolean;
  roundLabel: string;
  matchIndex: number;
}

export interface PositionedMatch extends DisplayMatch {
  laneId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BracketColumn {
  key: string;
  label: string;
  x: number;
  laneId: string;
  top: number;
}

export interface BracketLane {
  id: string;
  label: string;
  hint: string;
  top: number;
  height: number;
  columns: BracketColumn[];
}

export interface BracketEdge {
  key: string;
  fromKey: string;
  toKey: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  tone: 'winner' | 'loser' | 'neutral';
}

export interface BracketLayout {
  lanes: BracketLane[];
  matches: PositionedMatch[];
  edges: BracketEdge[];
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
}

interface MatchRef {
  key: string;
  slot: 'A' | 'B' | 'both';
  outcome: 'WINNER' | 'LOSER' | 'ALL';
}

interface Feed {
  connector: ConnectorConfig;
  source: BlockView;
  outcome: 'WINNER' | 'LOSER' | 'ALL';
}

export function buildBracketLayout(
  stageBlocks: BlockView[],
  allBlocks: BlockView[],
  allConnectors: ConnectorConfig[],
): BracketLayout {
  const blocksById = new Map(allBlocks.map((block) => [block.id, block]));
  const bracketBlocks = stageBlocks.filter((block) => block.type === 'BRACKET');
  const bracketIds = new Set(bracketBlocks.map((block) => block.id));
  const bracketConnectors = allConnectors.filter(
    (connector) => bracketIds.has(connector.sourceBlockId) && bracketIds.has(connector.targetBlockId),
  );

  const order = topoOrder(bracketBlocks, bracketConnectors);
  const incomingByBlock = groupIncoming(bracketConnectors);
  const lanesByBlock = classifyLanes(order, incomingByBlock);

  const expectedCache = new Map<string, number>();
  const displayByBlock = new Map<string, DisplayMatch[]>();
  const displayByKey = new Map<string, DisplayMatch>();

  for (const block of order) {
    const matches = buildDisplayMatches(
      block,
      blocksById,
      allConnectors,
      displayByBlock,
      displayByKey,
      bracketIds,
      expectedCache,
    );
    displayByBlock.set(block.id, matches);
    for (const display of matches) displayByKey.set(display.key, display);
  }

  const laneDefinitions: Array<{ id: string; label: string; hint: string; blocks: BlockView[] }> = [];
  const upper = order.filter((block) => lanesByBlock.get(block.id) === 'upper');
  const lower = order.filter((block) => lanesByBlock.get(block.id) === 'lower');
  const finals = order.filter((block) => lanesByBlock.get(block.id) === 'final');
  const hasSplit = lower.length > 0 || finals.length > 0;

  if (upper.length > 0) {
    laneDefinitions.push({
      id: 'upper',
      label: hasSplit ? 'Tableau des gagnants' : 'Tableau',
      hint: hasSplit ? 'Une défaite envoie au tableau des perdants' : 'Élimination directe',
      blocks: upper,
    });
  }
  if (lower.length > 0) {
    laneDefinitions.push({
      id: 'lower',
      label: 'Tableau des perdants',
      hint: 'Une seconde défaite élimine',
      blocks: lower,
    });
  }
  if (finals.length > 0) {
    laneDefinitions.push({
      id: 'final',
      label: 'Grande finale',
      hint: 'Le titre se joue ici',
      blocks: finals,
    });
  }

  const refsByMatch = new Map<string, MatchRef[]>();
  for (const block of order) {
    const feeds = feedsFor(block, blocksById, bracketConnectors);
    const displays = displayByBlock.get(block.id) ?? [];
    for (const display of displays) {
      refsByMatch.set(
        display.key,
        resolveRefs(display, displays.length, feeds, displayByBlock, displayByKey),
      );
    }
  }

  const lanes: BracketLane[] = [];
  const positioned: PositionedMatch[] = [];
  const positions = new Map<string, PositionedMatch>();
  let laneTop = 0;

  for (const definition of laneDefinitions) {
    const laneIds = new Set(definition.blocks.map((block) => block.id));
    const depthByBlock = computeDepth(definition.blocks, bracketConnectors, laneIds);
    const maxDepth = Math.max(0, ...definition.blocks.map((block) => depthByBlock.get(block.id) ?? 0));
    const contentTop = laneTop + BRACKET_LANE_HEADER;
    let maxBottom = contentTop;

    for (let depth = 0; depth <= maxDepth; depth++) {
      const blocksAtDepth = definition.blocks
        .filter((block) => (depthByBlock.get(block.id) ?? 0) === depth)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const wanted: Array<{ display: DisplayMatch; wantedY: number; seq: number }> = [];
      let fallback = 0;

      for (const block of blocksAtDepth) {
        const displays = (displayByBlock.get(block.id) ?? []).slice().sort(
          (a, b) => a.matchIndex - b.matchIndex,
        );
        for (const display of displays) {
          const sourceCenters: number[] = [];
          for (const ref of refsByMatch.get(display.key) ?? []) {
            const source = positions.get(ref.key);
            if (source && source.laneId === definition.id) {
              sourceCenters.push(source.y + BRACKET_CARD_HEIGHT / 2);
            }
          }
          const wantedY =
            sourceCenters.length > 0
              ? sourceCenters.reduce((sum, value) => sum + value, 0) / sourceCenters.length -
                BRACKET_CARD_HEIGHT / 2
              : contentTop + fallback;
          wanted.push({ display, wantedY, seq: wanted.length });
          fallback += BRACKET_CARD_HEIGHT + BRACKET_CARD_GAP;
        }
      }

      wanted.sort((a, b) => a.wantedY - b.wantedY || a.seq - b.seq);
      let cursor = contentTop;
      for (const item of wanted) {
        const y = Math.max(contentTop, cursor, item.wantedY);
        const x = BRACKET_PADDING + depth * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP);
        const positionedMatch: PositionedMatch = {
          ...item.display,
          laneId: definition.id,
          x,
          y,
          width: BRACKET_CARD_WIDTH,
          height: BRACKET_CARD_HEIGHT,
        };
        positioned.push(positionedMatch);
        positions.set(item.display.key, positionedMatch);
        cursor = y + BRACKET_CARD_HEIGHT + BRACKET_CARD_GAP;
        maxBottom = Math.max(maxBottom, y + BRACKET_CARD_HEIGHT);
      }
    }

    const columns: BracketColumn[] = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
      const firstBlock = definition.blocks
        .filter((block) => (depthByBlock.get(block.id) ?? 0) === depth)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      if (!firstBlock) continue;
      columns.push({
        key: `${definition.id}:${depth}`,
        label: laneColumnLabel(definition.id, depth, maxDepth, firstBlock),
        x: BRACKET_PADDING + depth * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP),
        laneId: definition.id,
        top: laneTop,
      });
    }

    const height = Math.max(BRACKET_LANE_HEADER + BRACKET_CARD_HEIGHT, maxBottom - laneTop + 18);
    lanes.push({
      id: definition.id,
      label: definition.label,
      hint: definition.hint,
      top: laneTop,
      height,
      columns,
    });
    laneTop += height + BRACKET_LANE_GAP;
  }

  const edges: BracketEdge[] = [];
  for (const display of positioned) {
    for (const ref of refsByMatch.get(display.key) ?? []) {
      const source = positions.get(ref.key);
      if (!source) continue;
      const targetY =
        ref.slot === 'A'
          ? display.y + 24
          : ref.slot === 'B'
            ? display.y + BRACKET_CARD_HEIGHT - 22
            : display.y + BRACKET_CARD_HEIGHT / 2;
      edges.push({
        key: `${ref.key}->${display.key}:${ref.slot}`,
        fromKey: ref.key,
        toKey: display.key,
        from: { x: source.x + BRACKET_CARD_WIDTH, y: source.y + BRACKET_CARD_HEIGHT / 2 },
        to: { x: display.x, y: targetY },
        tone: ref.outcome === 'LOSER' ? 'loser' : ref.outcome === 'ALL' ? 'neutral' : 'winner',
      });
    }
  }

  const maxColumns = Math.max(
    1,
    ...lanes.map((lane) => Math.max(1, ...lane.columns.map((_, index) => index + 1))),
  );
  const width =
    BRACKET_PADDING * 2 +
    maxColumns * BRACKET_CARD_WIDTH +
    Math.max(0, maxColumns - 1) * BRACKET_COLUMN_GAP;
  const height = Math.max(laneTop - BRACKET_LANE_GAP, BRACKET_LANE_HEADER + BRACKET_CARD_HEIGHT);

  return {
    lanes,
    matches: positioned,
    edges,
    width,
    height,
    cardWidth: BRACKET_CARD_WIDTH,
    cardHeight: BRACKET_CARD_HEIGHT,
  };
}

function laneColumnLabel(
  laneId: string,
  depth: number,
  maxDepth: number,
  block: BlockView,
): string {
  if (laneId === 'final') {
    if (depth === 0) return maxDepth > 0 ? 'Grande finale' : 'Finale';
    return block.config.skipCondition ? 'Bracket reset (si nécessaire)' : 'Finale décisive';
  }
  return knockoutColumnLabel(maxDepth - depth + 1);
}

function topoOrder(blocks: BlockView[], connectors: ConnectorConfig[]): BlockView[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const incoming = groupIncoming(connectors);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: BlockView[] = [];

  const visit = (block: BlockView): void => {
    if (visited.has(block.id) || visiting.has(block.id)) return;
    visiting.add(block.id);
    for (const connector of incoming.get(block.id) ?? []) {
      const source = byId.get(connector.sourceBlockId);
      if (source) visit(source);
    }
    visiting.delete(block.id);
    visited.add(block.id);
    result.push(block);
  };

  for (const block of blocks) visit(block);
  return result;
}

function groupIncoming(connectors: ConnectorConfig[]): Map<string, ConnectorConfig[]> {
  const map = new Map<string, ConnectorConfig[]>();
  for (const connector of connectors) {
    const list = map.get(connector.targetBlockId) ?? [];
    list.push(connector);
    map.set(connector.targetBlockId, list);
  }
  return map;
}

function classifyLanes(
  order: BlockView[],
  incomingByBlock: Map<string, ConnectorConfig[]>,
): Map<string, 'upper' | 'lower' | 'final'> {
  const lanes = new Map<string, 'upper' | 'lower' | 'final'>();
  for (const block of order) {
    const incoming = incomingByBlock.get(block.id) ?? [];
    if (incoming.some((connector) => lanes.get(connector.sourceBlockId) === 'final')) {
      lanes.set(block.id, 'final');
      continue;
    }
    const lowerFeed = incoming.some(
      (connector) =>
        connector.filterRule.type === 'LOSERS' ||
        lanes.get(connector.sourceBlockId) === 'lower',
    );
    const upperFeed = incoming.some(
      (connector) =>
        connector.filterRule.type !== 'LOSERS' &&
        lanes.get(connector.sourceBlockId) !== 'lower' &&
        lanes.get(connector.sourceBlockId) !== 'final',
    );
    if (lowerFeed && upperFeed) lanes.set(block.id, 'final');
    else if (lowerFeed) lanes.set(block.id, 'lower');
    else lanes.set(block.id, 'upper');
  }
  return lanes;
}

function computeDepth(
  blocks: BlockView[],
  connectors: ConnectorConfig[],
  laneIds: Set<string>,
): Map<string, number> {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const incoming = groupIncoming(
    connectors.filter(
      (connector) =>
        laneIds.has(connector.sourceBlockId) && laneIds.has(connector.targetBlockId),
    ),
  );
  const depth = new Map<string, number>();
  const visit = (block: BlockView): number => {
    const known = depth.get(block.id);
    if (known !== undefined) return known;
    const sources = (incoming.get(block.id) ?? [])
      .map((connector) => byId.get(connector.sourceBlockId))
      .filter((source): source is BlockView => source !== undefined);
    const value = sources.length === 0 ? 0 : Math.max(...sources.map(visit)) + 1;
    depth.set(block.id, value);
    return value;
  };
  for (const block of blocks) visit(block);
  return depth;
}

function feedsFor(
  block: BlockView,
  blocksById: Map<string, BlockView>,
  connectors: ConnectorConfig[],
): Feed[] {
  const feeds: Feed[] = [];
  for (const connector of connectors) {
    if (connector.targetBlockId !== block.id) continue;
    const source = blocksById.get(connector.sourceBlockId);
    if (!source) continue;
    feeds.push({
      connector,
      source,
      outcome:
        connector.filterRule.type === 'LOSERS'
          ? 'LOSER'
          : connector.filterRule.type === 'ALL'
            ? 'ALL'
            : 'WINNER',
    });
  }
  return feeds;
}

function buildDisplayMatches(
  block: BlockView,
  blocksById: Map<string, BlockView>,
  allConnectors: ConnectorConfig[],
  displayByBlock: Map<string, DisplayMatch[]>,
  displayByKey: Map<string, DisplayMatch>,
  bracketIds: Set<string>,
  expectedCache: Map<string, number>,
): DisplayMatch[] {
  if (block.matches.length > 0) {
    return block.matches
      .slice()
      .sort((a, b) => a.matchIndex - b.matchIndex)
      .map((match) => ({
        key: `${block.id}:${match.matchIndex}`,
        blockId: block.id,
        block,
        match,
        projected: false,
        roundLabel: '',
        matchIndex: match.matchIndex,
      }));
  }

  if (block.state === 'SKIPPED' || block.state === 'COMPLETED') return [];

  const count = expectedMatchCount(block, blocksById, allConnectors, bracketIds, expectedCache);
  const feeds = feedsFor(
    block,
    blocksById,
    allConnectors.filter(
      (connector) =>
        bracketIds.has(connector.sourceBlockId) && bracketIds.has(connector.targetBlockId),
    ),
  );

  const displays: DisplayMatch[] = [];
  for (let index = 0; index < count; index++) {
    const refs = projectionRefs(index, count, feeds, displayByBlock);
    const [slotA, slotB] = projectedSlots(refs, feeds[0]?.connector, displayByKey);
    const resolved = slotA.type === 'RESOLVED' && slotB.type === 'RESOLVED';
    const match: Match = {
      id: `${block.id}:projected:${index}`,
      blockId: block.id,
      roundNumber: block.roundNumber,
      matchIndex: index,
      slotA,
      slotB,
      state: resolved ? 'READY' : 'WAITING_FOR_SLOTS',
    };
    displays.push({
      key: `${block.id}:${index}`,
      blockId: block.id,
      block,
      match,
      projected: true,
      roundLabel: '',
      matchIndex: index,
    });
  }
  return displays;
}

function expectedMatchCount(
  block: BlockView,
  blocksById: Map<string, BlockView>,
  connectors: ConnectorConfig[],
  bracketIds: Set<string>,
  cache: Map<string, number>,
  visiting = new Set<string>(),
): number {
  if (block.matches.length > 0) return block.matches.length;
  if (block.state === 'SKIPPED') return 0;
  const cached = cache.get(block.id);
  if (cached !== undefined) return cached;
  if (visiting.has(block.id)) return 0;
  visiting.add(block.id);

  const incoming = connectors.filter((connector) => connector.targetBlockId === block.id);
  let teams = 0;
  if (incoming.length === 0) {
    teams = block.inputTeamIds.length;
  } else {
    for (const connector of incoming) {
      const source = blocksById.get(connector.sourceBlockId);
      if (!source) continue;
      const rule = connector.filterRule;
      if (rule.type === 'TOP_N' || rule.type === 'BOTTOM_N') {
        teams += rule.count;
      } else if (rule.type === 'RANGE') {
        teams += Math.max(0, rule.endRank - rule.startRank + 1);
      } else if (rule.type === 'WINNERS' || rule.type === 'LOSERS') {
        teams += expectedMatchCount(source, blocksById, connectors, bracketIds, cache, visiting);
      } else if (rule.type === 'ALL') {
        teams += expectedParticipantCount(source, blocksById, connectors, bracketIds, cache, visiting);
      } else {
        teams += expectedParticipantCount(source, blocksById, connectors, bracketIds, cache, visiting);
      }
    }
  }

  visiting.delete(block.id);
  const value = Math.max(0, Math.ceil(teams / 2));
  cache.set(block.id, value);
  return value;
}

function expectedParticipantCount(
  block: BlockView,
  blocksById: Map<string, BlockView>,
  connectors: ConnectorConfig[],
  bracketIds: Set<string>,
  cache: Map<string, number>,
  visiting: Set<string>,
): number {
  if (block.matches.length > 0) {
    return Math.max(participantIds(block).length, block.matches.length * 2);
  }
  return Math.max(
    block.inputTeamIds.length,
    expectedMatchCount(block, blocksById, connectors, bracketIds, cache, visiting) * 2,
  );
}

function resolveRefs(
  display: DisplayMatch,
  targetCount: number,
  feeds: Feed[],
  displayByBlock: Map<string, DisplayMatch[]>,
  displayByKey: Map<string, DisplayMatch>,
): MatchRef[] {
  const refs: MatchRef[] = [];
  const pointerFor = (slot: ParticipantSlot): MatchRef | null => {
    if (slot.type !== 'PENDING_POINTER') return null;
    for (const [key, candidate] of displayByKey) {
      if (candidate.match.id !== slot.sourceMatchId) continue;
      return {
        key,
        slot: 'both',
        outcome: slot.outcome === 'LOSER' ? 'LOSER' : 'WINNER',
      };
    }
    return null;
  };

  const slotARef = pointerFor(display.match.slotA);
  const slotBRef = pointerFor(display.match.slotB);
  if (slotARef) refs.push({ ...slotARef, slot: 'A' });
  if (slotBRef) refs.push({ ...slotBRef, slot: 'B' });
  if (refs.length >= 2) return refs;

  if (feeds.length === 1) {
    const feed = feeds[0];
    const sources = (displayByBlock.get(feed.source.id) ?? []).slice().sort(
      (a, b) => a.matchIndex - b.matchIndex,
    );
    if (sources.length === 0) return refs;
    const sameShape = sources.length === targetCount;
    if (sameShape && feed.outcome === 'ALL') {
      const source = sources[Math.min(display.matchIndex, sources.length - 1)];
      if (!refs.some((ref) => ref.slot === 'A')) {
        refs.push({ key: source.key, slot: 'A', outcome: 'ALL' });
      }
      if (!refs.some((ref) => ref.slot === 'B')) {
        refs.push({ key: source.key, slot: 'B', outcome: 'ALL' });
      }
      return refs;
    }
    const first = sources[display.matchIndex * 2];
    const second = sources[display.matchIndex * 2 + 1] ?? first;
    if (first && !refs.some((ref) => ref.slot === 'A')) {
      refs.push({ key: first.key, slot: 'A', outcome: feed.outcome });
    }
    if (second && !refs.some((ref) => ref.slot === 'B')) {
      refs.push({ key: second.key, slot: 'B', outcome: feed.outcome });
    }
    return refs;
  }

  feeds.forEach((feed, feedIndex) => {
    const slot: 'A' | 'B' = feedIndex === 0 ? 'A' : 'B';
    if (refs.some((ref) => ref.slot === slot)) return;
    const sources = (displayByBlock.get(feed.source.id) ?? []).slice().sort(
      (a, b) => a.matchIndex - b.matchIndex,
    );
    const source = sources[Math.min(display.matchIndex, sources.length - 1)];
    if (source) refs.push({ key: source.key, slot, outcome: feed.outcome });
  });
  return refs;
}

function projectionRefs(
  index: number,
  targetCount: number,
  feeds: Feed[],
  displayByBlock: Map<string, DisplayMatch[]>,
): MatchRef[] {
  const refs: MatchRef[] = [];
  if (feeds.length === 1) {
    const feed = feeds[0];
    const sources = (displayByBlock.get(feed.source.id) ?? []).slice().sort(
      (a, b) => a.matchIndex - b.matchIndex,
    );
    if (sources.length === 0) return refs;
    if (sources.length === targetCount && feed.outcome === 'ALL') {
      const source = sources[Math.min(index, sources.length - 1)];
      refs.push({ key: source.key, slot: 'A', outcome: 'ALL' });
      refs.push({ key: source.key, slot: 'B', outcome: 'ALL' });
      return refs;
    }
    const first = sources[index * 2];
    const second = sources[index * 2 + 1] ?? first;
    if (first) refs.push({ key: first.key, slot: 'A', outcome: feed.outcome });
    if (second) refs.push({ key: second.key, slot: 'B', outcome: feed.outcome });
    return refs;
  }

  feeds.forEach((feed, feedIndex) => {
    if (feedIndex > 1) return;
    const sources = (displayByBlock.get(feed.source.id) ?? []).slice().sort(
      (a, b) => a.matchIndex - b.matchIndex,
    );
    const source = sources[Math.min(index, sources.length - 1)];
    if (source) {
      refs.push({
        key: source.key,
        slot: feedIndex === 0 ? 'A' : 'B',
        outcome: feed.outcome,
      });
    }
  });
  return refs;
}

function projectedSlots(
  refs: MatchRef[],
  firstConnector: ConnectorConfig | undefined,
  displayByKey: Map<string, DisplayMatch>,
): [ParticipantSlot, ParticipantSlot] {
  const generic = (): ParticipantSlot => ({
    type: 'PENDING_POINTER',
    sourceBlockId: firstConnector?.sourceBlockId ?? 'inconnu',
    sourceMatchId: `${firstConnector?.id ?? 'qualification'}:qualifier`,
    outcome: 'WINNER',
  });

  const slotA =
    projectSlot(refs.find((ref) => ref.slot === 'A'), 'A', displayByKey) ?? generic();
  const slotB =
    projectSlot(refs.find((ref) => ref.slot === 'B'), 'B', displayByKey) ??
    (refs.length === 0 && firstConnector ? generic() : pendingFromRef(refs[0], 'B'));
  return [slotA, slotB];
}

function projectSlot(
  ref: MatchRef | undefined,
  side: 'A' | 'B',
  displayByKey: Map<string, DisplayMatch>,
): ParticipantSlot | undefined {
  if (!ref) return undefined;
  const source = displayByKey.get(ref.key);
  const match = source?.match;
  if (!match) return pendingFromRef(ref, side);

  const teamId =
    ref.outcome === 'LOSER'
      ? match.loserId
      : ref.outcome === 'ALL'
        ? ref.slot === 'A'
          ? match.slotA.type === 'RESOLVED'
            ? match.slotA.teamId
            : undefined
          : match.slotB.type === 'RESOLVED'
            ? match.slotB.teamId
            : undefined
        : match.winnerId;

  if (typeof teamId === 'string' && teamId !== 'BYE' && teamId !== 'DRAW') {
    return { type: 'RESOLVED', teamId };
  }
  return pendingFromRef(ref, side);
}

function pendingFromRef(
  ref: MatchRef | undefined,
  side: 'A' | 'B' = 'A',
): ParticipantSlot {
  if (!ref) {
    return {
      type: 'PENDING_POINTER',
      sourceBlockId: 'inconnu',
      sourceMatchId: 'qualification:qualifier',
      outcome: 'WINNER',
    };
  }
  return {
    type: 'PENDING_POINTER',
    sourceBlockId: ref.key.split(':')[0] ?? 'inconnu',
    sourceMatchId: ref.key,
    outcome:
      ref.outcome === 'LOSER' || (ref.outcome === 'ALL' && side === 'B')
        ? 'LOSER'
        : 'WINNER',
  };
}

export function bracketPointerLabels(layout: BracketLayout): Map<string, string> {
  const labels = new Map<string, string>();
  const split = layout.lanes.some((lane) => lane.id === 'lower');
  for (const lane of layout.lanes) {
    const laneMatches = layout.matches.filter((match) => match.laneId === lane.id);
    const columnCount = lane.columns.length;
    const suffix =
      split && lane.id === 'upper' ? ' gagnants' : split && lane.id === 'lower' ? ' perdants' : '';
    for (const column of lane.columns) {
      const index = lane.columns.indexOf(column);
      const remaining = columnCount - index;
      for (const match of laneMatches.filter((candidate) => candidate.x === column.x)) {
        const prefix =
          lane.id === 'final' ? column.label : shortRoundLabel(remaining);
        const label = `${prefix}${suffix} ${match.matchIndex + 1}`;
        labels.set(match.match.id, label);
        labels.set(match.key, label);
      }
    }
  }
  return labels;
}

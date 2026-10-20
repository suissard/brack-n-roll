import type {
  ConnectorConfig,
  FormatBlockDefinition,
  TournamentFormat,
} from '../../../../src/index';
import { asString } from './formatHelpers';

export interface MindmapNode {
  /** Index d'origine dans `format.blocks` (stable pour les callbacks). */
  index: number;
  id: string;
  block: FormatBlockDefinition;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  incoming: number;
  outgoing: number;
}

export interface MindmapEdge {
  /** Index d'origine dans `format.connectors` (stable pour les callbacks). */
  index: number;
  connector: ConnectorConfig;
  from: MindmapNode;
  to: MindmapNode;
  path: string;
  labelX: number;
  labelY: number;
}

export interface MindmapLayout {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  width: number;
  height: number;
  layers: number;
}

const NODE_WIDTH = 216;
const NODE_HEIGHT = 108;
const H_GAP = 124;
const V_GAP = 30;
const PADDING = 36;
const PARALLEL_OFFSET = 18;

function cubicPoint(
  start: number,
  c1: number,
  c2: number,
  end: number,
  t = 0.5,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * start +
    3 * mt * mt * t * c1 +
    3 * mt * t * t * c2 +
    t * t * t * end
  );
}

/**
 * Calcule une disposition en couches (gauche → droite) du DAG.
 *
 * Les blocs sont rangés par plus long chemin depuis les sources : deux blocs
 * qui peuvent tourner en parallèle restent sur la même colonne. Les arêtes
 * sont des courbes de Bézier, décalées lorsqu'un même couple source/cible
 * possède plusieurs connecteurs.
 */
export function buildMindmapLayout(format: TournamentFormat): MindmapLayout {
  const blocks = format.blocks;
  const ids = blocks.map((block) => asString(block.config.id));
  const idSet = new Set(ids);

  const successors = new Map<string, Set<string>>();
  const predecessors = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const id of ids) {
    successors.set(id, new Set());
    predecessors.set(id, new Set());
    indegree.set(id, 0);
  }

  for (const connector of format.connectors) {
    const { sourceBlockId, targetBlockId } = connector;
    if (
      !idSet.has(sourceBlockId) ||
      !idSet.has(targetBlockId) ||
      sourceBlockId === targetBlockId
    ) {
      continue;
    }
    const outgoing = successors.get(sourceBlockId);
    if (outgoing && !outgoing.has(targetBlockId)) {
      outgoing.add(targetBlockId);
      predecessors.get(targetBlockId)?.add(sourceBlockId);
      indegree.set(targetBlockId, (indegree.get(targetBlockId) ?? 0) + 1);
    }
  }

  const layerById = new Map<string, number>();
  ids.forEach((id) => layerById.set(id, 0));

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const target of successors.get(id) ?? []) {
      layerById.set(
        target,
        Math.max(layerById.get(target) ?? 0, (layerById.get(id) ?? 0) + 1),
      );
      const remaining = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  // Un cycle peut exister pendant l'édition : on place les blocs restants au
  // plus loin possible sans boucler indéfiniment.
  if (visited.size < ids.length) {
    for (const id of ids) {
      if (visited.has(id)) continue;
      let layer = layerById.get(id) ?? 0;
      for (const predecessor of predecessors.get(id) ?? []) {
        if (visited.has(predecessor)) {
          layer = Math.max(layer, (layerById.get(predecessor) ?? 0) + 1);
        }
      }
      layerById.set(id, layer);
      visited.add(id);
    }
  }

  const byLayer = new Map<number, number[]>();
  blocks.forEach((_, index) => {
    const id = ids[index];
    const layer = layerById.get(id) ?? 0;
    const group = byLayer.get(layer) ?? [];
    group.push(index);
    byLayer.set(layer, group);
  });

  const layerCount = Math.max(1, ...Array.from(byLayer.keys(), (layer) => layer + 1));
  const tallest = Math.max(
    1,
    ...Array.from(byLayer.values(), (group) => group.length),
  );
  const tallestHeight = tallest * NODE_HEIGHT + (tallest - 1) * V_GAP;

  const nodes: MindmapNode[] = [];
  const nodeById = new Map<string, MindmapNode>();

  for (let layer = 0; layer < layerCount; layer += 1) {
    const group = byLayer.get(layer) ?? [];
    const columnHeight = group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * V_GAP;
    const offset = (tallestHeight - columnHeight) / 2;

    group.forEach((blockIndex, position) => {
      const block = blocks[blockIndex];
      const id = ids[blockIndex];
      const node: MindmapNode = {
        index: blockIndex,
        id,
        block,
        layer,
        x: PADDING + layer * (NODE_WIDTH + H_GAP),
        y: PADDING + offset + position * (NODE_HEIGHT + V_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        incoming: 0,
        outgoing: 0,
      };
      nodes.push(node);
      if (!nodeById.has(id)) nodeById.set(id, node);
    });
  }

  // Compteurs affichés sur les blocs.
  for (const connector of format.connectors) {
    if (connector.sourceBlockId === connector.targetBlockId) continue;
    const source = nodeById.get(connector.sourceBlockId);
    const target = nodeById.get(connector.targetBlockId);
    if (source) source.outgoing += 1;
    if (target) target.incoming += 1;
  }

  const pairTotals = new Map<string, number>();
  for (const connector of format.connectors) {
    const key = `${connector.sourceBlockId}->${connector.targetBlockId}`;
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + 1);
  }
  const pairCursor = new Map<string, number>();

  const edges: MindmapEdge[] = [];
  format.connectors.forEach((connector, index) => {
    const from = nodeById.get(connector.sourceBlockId);
    const to = nodeById.get(connector.targetBlockId);
    if (!from || !to) return;

    const key = `${connector.sourceBlockId}->${connector.targetBlockId}`;
    const total = pairTotals.get(key) ?? 1;
    const cursor = pairCursor.get(key) ?? 0;
    pairCursor.set(key, cursor + 1);

    const shift = (cursor - (total - 1) / 2) * PARALLEL_OFFSET;
    const sx = from.x + from.width;
    const sy = from.y + from.height / 2 + shift;
    const tx = to.x;
    const ty = to.y + to.height / 2 + shift;

    let c1x: number;
    let c1y: number;
    let c2x: number;
    let c2y: number;

    if (tx > sx + 24) {
      const reach = Math.max(52, (tx - sx) * 0.46);
      c1x = sx + reach;
      c1y = sy;
      c2x = tx - reach;
      c2y = ty;
    } else {
      // Même colonne ou retour arrière : on boucle au-dessus / en dessous
      // pour garder le lien lisible.
      const loop = 78 + Math.abs(shift);
      const direction = ty >= sy ? 1 : -1;
      c1x = sx + loop;
      c1y = sy + direction * 46;
      c2x = tx - loop;
      c2y = ty - direction * 46;
    }

    edges.push({
      index,
      connector,
      from,
      to,
      path: `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`,
      labelX: cubicPoint(sx, c1x, c2x, tx),
      labelY: cubicPoint(sy, c1y, c2y, ty),
    });
  });

  const width = Math.max(
    680,
    PADDING * 2 + layerCount * NODE_WIDTH + Math.max(0, layerCount - 1) * H_GAP,
  );
  const height = Math.max(320, PADDING * 2 + tallestHeight);

  return { nodes, edges, width, height, layers: layerCount };
}

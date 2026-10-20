import { describe, expect, it } from 'vitest';
import {
  emptyTournamentFormat,
  type ConnectorConfig,
  type FormatBlockDefinition,
  type TournamentFormat,
} from '../src/index';
import { buildMindmapLayout } from '../web/src/components/format/mindmapLayout';
import {
  removeBlock,
  removeConnector,
  renameBlockId,
  renameConnectorId,
} from '../web/src/components/format/formatHelpers';

function block(id: string, blockType: FormatBlockDefinition['blockType'] = 'BRACKET'): FormatBlockDefinition {
  return { blockType, config: { id, stageId: 'test', roundNumber: 1 } };
}

function connector(sourceBlockId: string, targetBlockId: string, id = `conn-${sourceBlockId}-${targetBlockId}`): ConnectorConfig {
  return {
    id,
    sourceBlockId,
    targetBlockId,
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
  };
}

function formatWith(blocks: FormatBlockDefinition[], connectors: ConnectorConfig[]): TournamentFormat {
  const format = emptyTournamentFormat({ id: 'test', name: 'Test' });
  return {
    ...format,
    blocks,
    connectors,
    entryBlockId: String(blocks[0]?.config.id ?? ''),
  };
}

describe('buildMindmapLayout', () => {
  it('range les blocs en colonnes selon le plus long chemin', () => {
    const format = formatWith(
      [block('a'), block('b'), block('c')],
      [connector('a', 'b'), connector('b', 'c')],
    );
    const layout = buildMindmapLayout(format);

    expect(layout.layers).toBe(3);
    const [a, b, c] = layout.nodes;
    expect(a.layer).toBe(0);
    expect(b.layer).toBe(1);
    expect(c.layer).toBe(2);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(layout.edges).toHaveLength(2);
  });

  it('garde deux blocs parallèles sur la même colonne', () => {
    const format = formatWith(
      [block('start'), block('winners'), block('losers'), block('final')],
      [
        connector('start', 'winners'),
        connector('start', 'losers'),
        connector('winners', 'final'),
        connector('losers', 'final'),
      ],
    );
    const layout = buildMindmapLayout(format);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get('winners')?.layer).toBe(1);
    expect(byId.get('losers')?.layer).toBe(1);
    expect(byId.get('final')?.layer).toBe(2);
    expect(byId.get('winners')?.x).toBe(byId.get('losers')?.x);
    expect(byId.get('winners')?.y).not.toBe(byId.get('losers')?.y);
  });

  it('décale les arêtes parallèles entre un même couple de blocs', () => {
    const format = formatWith(
      [block('a'), block('b')],
      [connector('a', 'b', 'first'), connector('a', 'b', 'second')],
    );
    const layout = buildMindmapLayout(format);

    expect(layout.edges).toHaveLength(2);
    expect(layout.edges[0].path).not.toBe(layout.edges[1].path);
    expect(layout.edges[0].labelY).not.toBe(layout.edges[1].labelY);
  });

  it('ignore les connecteurs orphelins et ne boucle pas sur un cycle', () => {
    const format = formatWith(
      [block('a'), block('b'), block('c')],
      [connector('a', 'b'), connector('b', 'a'), connector('a', 'inconnu')],
    );
    const layout = buildMindmapLayout(format);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('helpers du graphe de format', () => {
  it('renomme un bloc et met à jour connecteurs et entrée', () => {
    const format = formatWith(
      [block('a'), block('b')],
      [connector('a', 'b')],
    );
    const renamed = renameBlockId(format, 0, 'start');

    expect(renamed.entryBlockId).toBe('start');
    expect(renamed.blocks[0].config.id).toBe('start');
    expect(renamed.connectors[0].sourceBlockId).toBe('start');
  });

  it('renomme un connecteur et met à jour les conditions de court-circuit', () => {
    const format = formatWith(
      [
        block('a'),
        {
          ...block('b'),
          config: {
            ...block('b').config,
            skipCondition: {
              type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED' as const,
              connectorId: 'old',
            },
          },
        },
      ],
      [connector('a', 'b', 'old')],
    );
    const renamed = renameConnectorId(format, 0, 'new');
    const skip = renamed.blocks[1].config.skipCondition;

    expect(renamed.connectors[0].id).toBe('new');
    expect(skip).toEqual({
      type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED',
      connectorId: 'new',
    });
  });

  it('supprime un bloc, ses connecteurs et réassigne le bloc d’entrée', () => {
    const format = formatWith(
      [block('a'), block('b'), block('c')],
      [connector('a', 'b'), connector('b', 'c')],
    );
    const updated = removeBlock(format, 0);

    expect(updated.blocks.map((entry) => entry.config.id)).toEqual(['b', 'c']);
    expect(updated.connectors).toHaveLength(1);
    expect(updated.connectors[0].sourceBlockId).toBe('b');
    expect(updated.entryBlockId).toBe('b');
  });

  it('réinitialise les court-circuits qui visent un connecteur supprimé', () => {
    const format = formatWith(
      [
        block('a'),
        {
          ...block('b'),
          config: {
            ...block('b').config,
            skipCondition: {
              type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED' as const,
              connectorId: 'old',
            },
          },
        },
      ],
      [connector('a', 'b', 'old')],
    );
    const updated = removeConnector(format, 0);

    expect(updated.connectors).toHaveLength(0);
    expect(updated.blocks[1].config.skipCondition).toEqual({ type: 'NEVER' });
  });
});

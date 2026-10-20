import { useEffect, useMemo, useRef, useState } from 'react';
import type { TournamentFormat } from '../../../../src/index';
import {
  asString,
  blockMeta,
  blockTypeLabel,
  filterLabel,
} from './formatHelpers';
import { buildMindmapLayout } from './mindmapLayout';

export type MindmapSelection = { kind: 'block' | 'connector'; index: number } | null;

export interface LinkMode {
  /** `null` : on attend d'abord le bloc source. */
  sourceId: string | null;
}

interface Props {
  format: TournamentFormat;
  selection: MindmapSelection;
  linkMode: LinkMode | null;
  onSelectBlock: (index: number) => void;
  onSelectConnector: (index: number) => void;
  onStartLinkFromBlock: (blockId: string) => void;
  onLinkTarget: (index: number) => void;
  onCancelLink: () => void;
  onAddBlock: () => void;
  onStartNewConnector: () => void;
}

export function FormatMindmap({
  format,
  selection,
  linkMode,
  onSelectBlock,
  onSelectConnector,
  onStartLinkFromBlock,
  onLinkTarget,
  onCancelLink,
  onAddBlock,
  onStartNewConnector,
}: Props) {
  const layout = useMemo(() => buildMindmapLayout(format), [format]);
  const sourceId = linkMode?.sourceId ?? null;
  const linking = linkMode !== null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    setViewportWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Ajuste le graphe à la largeur disponible, sans jamais rapetisser en
  // dessous de 60 % (en dessous, le scroll horizontal prend le relais).
  const scale =
    viewportWidth > 0
      ? Math.min(1, Math.max(0.6, (viewportWidth - 2) / layout.width))
      : 1;

  const activateNode = (index: number) => {
    if (linking) onLinkTarget(index);
    else onSelectBlock(index);
  };

  const activateConnector = (index: number) => {
    if (linking) return;
    onSelectConnector(index);
  };

  return (
    <section className="panel format-graph-panel">
      <header className="panel-header">
        <div>
          <h2>Graphe du format</h2>
          <p className="muted">
            {format.blocks.length} bloc(s) · {format.connectors.length} connecteur(s) · cliquez un
            bloc ou un lien pour éditer ses propriétés.
          </p>
        </div>
        <div className="format-graph-actions">
          <button type="button" className="mini" onClick={onAddBlock}>
            + Bloc
          </button>
          <button
            type="button"
            className="mini"
            onClick={onStartNewConnector}
            disabled={format.blocks.length < 2}
            title={
              format.blocks.length < 2
                ? 'Ajoutez au moins deux blocs pour créer un connecteur'
                : 'Relier deux blocs'
            }
          >
            + Connecteur
          </button>
        </div>
      </header>

      {linking && (
        <div className="format-link-banner" role="status">
          <span className="format-link-dot" aria-hidden="true" />
          <span>
            {sourceId === null ? (
              <>Sélectionnez le <strong>bloc source</strong> du nouveau connecteur.</>
            ) : (
              <>
                Cliquez sur le <strong>bloc cible</strong> pour relier{' '}
                <code>{sourceId}</code>.
              </>
            )}{' '}
            <span className="muted">Échap pour annuler.</span>
          </span>
          <button type="button" className="mini" onClick={onCancelLink}>
            Annuler
          </button>
        </div>
      )}

      <div className="format-mindmap-scroll" ref={scrollRef}>
        <div
          className="format-mindmap-scale"
          style={{ width: layout.width * scale, height: layout.height * scale }}
        >
          <div
            className={`format-mindmap-canvas${linking ? ' is-linking' : ''}`}
            style={{
              width: layout.width,
              height: layout.height,
              transform: `scale(${scale})`,
            }}
            onClick={() => {
              if (linking) onCancelLink();
            }}
          >
            <svg
              className="format-mindmap-edges"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="mindmap-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#7282a4" />
                </marker>
                <marker
                  id="mindmap-arrow-active"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f8cff" />
                </marker>
              </defs>

              {layout.edges.map((edge) => {
                const active =
                  selection?.kind === 'connector' && selection.index === edge.index;
                const title = `${edge.connector.id} : ${edge.connector.sourceBlockId} → ${
                  edge.connector.targetBlockId
                } · ${filterLabel(edge.connector.filterRule)} · ${edge.connector.transferMode}`;
                return (
                  <g key={`edge-${edge.index}`}>
                    <path
                      d={edge.path}
                      className={`mindmap-edge-hit${linking ? ' is-disabled' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        activateConnector(edge.index);
                      }}
                    >
                      <title>{title}</title>
                    </path>
                    <path
                      d={edge.path}
                      className={`mindmap-edge${active ? ' is-active' : ''}`}
                      markerEnd={`url(#${active ? 'mindmap-arrow-active' : 'mindmap-arrow'})`}
                      pointerEvents="none"
                    />
                  </g>
                );
              })}
            </svg>

            {layout.edges.map((edge) => {
              const active =
                selection?.kind === 'connector' && selection.index === edge.index;
              return (
                <button
                  key={`label-${edge.index}`}
                  type="button"
                  className={`mindmap-edge-label${active ? ' is-active' : ''}`}
                  style={{ left: edge.labelX, top: edge.labelY }}
                  onClick={(event) => {
                    event.stopPropagation();
                    activateConnector(edge.index);
                  }}
                  disabled={linking}
                  title={`${edge.connector.id} → ${filterLabel(edge.connector.filterRule)} (${edge.connector.transferMode})`}
                >
                  {filterLabel(edge.connector.filterRule)}
                </button>
              );
            })}

            {layout.nodes.map((node) => {
              const selected = selection?.kind === 'block' && selection.index === node.index;
              const isEntry = format.entryBlockId === node.id;
              const isSource = sourceId !== null && sourceId === node.id;
              return (
                <div
                  key={`node-${node.index}-${node.id}`}
                  role="button"
                  tabIndex={0}
                  className={[
                    'mindmap-node',
                    `tone-${node.block.blockType.toLowerCase()}`,
                    selected ? 'is-selected' : '',
                    isEntry ? 'is-entry' : '',
                    isSource ? 'is-link-source' : '',
                    linking && !isSource ? 'is-link-target' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    activateNode(node.index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activateNode(node.index);
                    }
                  }}
                  aria-label={`${blockTypeLabel(node.block.blockType)} ${node.id}${
                    isEntry ? ', bloc d’entrée' : ''
                  }`}
                >
                  <div className="mindmap-node-header">
                    <span className="mindmap-node-type">
                      {blockTypeLabel(node.block.blockType)}
                    </span>
                    {isEntry && <span className="mindmap-node-entry">Entrée</span>}
                    <button
                      type="button"
                      className="mindmap-node-link"
                      title={`Créer un connecteur depuis ${node.id || 'ce bloc'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartLinkFromBlock(asString(node.block.config.id));
                      }}
                    >
                      Relier
                    </button>
                  </div>

                  <strong className="mindmap-node-id">
                    {node.id || <em>(sans identifiant)</em>}
                  </strong>
                  <span className="mindmap-node-meta">{blockMeta(node.block)}</span>

                  <div className="mindmap-node-footer">
                    <span>{node.incoming} entrée(s)</span>
                    <span>{node.outgoing} sortie(s)</span>
                  </div>
                </div>
              );
            })}

            {layout.nodes.length === 0 && (
              <div className="format-mindmap-empty">
                <p>Aucun bloc pour l’instant.</p>
                <button type="button" className="primary" onClick={onAddBlock}>
                  Créer le premier bloc
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="format-mindmap-legend">
        <span>
          <i className="legend-swatch tone-swiss" /> Suisse
        </span>
        <span>
          <i className="legend-swatch tone-bracket" /> Bracket
        </span>
        <span>
          <i className="legend-swatch tone-round_robin" /> Toutes rondes
        </span>
        <span>
          <i className="legend-swatch tone-merger" /> Fusion
        </span>
        <span className="format-mindmap-hint">
          « Relier » démarre un connecteur ; cliquez ensuite le bloc cible.
        </span>
      </footer>
    </section>
  );
}

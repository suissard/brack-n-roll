import type {
  FormatBlockDefinition,
  FormatValidationIssue,
  TournamentFormat,
  TournamentFormatMeta,
} from '../types/format.types';
import type { PointsConfig, TeamBase } from '../types/domain.types';
import { DEFAULT_POINTS_CONFIG, TournamentGraph, createBlock } from './tournament-graph';

export interface BuildFormatOptions {
  /** Démarre immédiatement le tournoi après le seeding. */
  autoStart?: boolean;
}

/**
 * Construit un `TournamentGraph` exécutable à partir d'un format déclaratif.
 *
 * Le format est validé avant construction ; on lève une erreur explicite si la
 * topologie est incohérente (bloc d'entrée manquant, connecteur orphelin...).
 */
export function createGraphFromFormat(
  format: TournamentFormat,
  options: BuildFormatOptions = {},
): TournamentGraph {
  const issues = validateTournamentFormat(format);
  if (issues.length > 0) {
    throw new Error(
      `createGraphFromFormat: ${issues.map((issue) => `${issue.path} (${issue.message})`).join(', ')}`,
    );
  }

  const graph = new TournamentGraph({
    prngSeed: format.prngSeed,
    pointsConfig: format.pointsConfig,
  });
  for (const definition of format.blocks) graph.addBlock(createBlock(definition));

  for (const connector of format.connectors) {
    const { id, sourceBlockId, targetBlockId, ...rest } = connector;
    graph.connect(sourceBlockId, targetBlockId, { id, ...rest });
  }

  if (format.teams.length > 0 && format.entryBlockId) {
    graph.seedTeams(structuredClone(format.teams), format.entryBlockId);
  }

  if (options.autoStart) graph.start();
  return graph;
}

/** Vérifie la cohérence d'un format et retourne la liste des problèmes. */
export function validateTournamentFormat(format: TournamentFormat): FormatValidationIssue[] {
  const issues: FormatValidationIssue[] = [];

  if (!format.id.trim()) issues.push({ path: 'id', message: 'identifiant requis' });
  if (!format.name.trim()) issues.push({ path: 'name', message: 'nom requis' });
  if (!Number.isFinite(format.prngSeed)) {
    issues.push({ path: 'prngSeed', message: 'graine PRNG numérique requise' });
  }

  const blockIds = new Set<string>();
  format.blocks.forEach((block, index) => {
    const id = block.config.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      issues.push({ path: `blocks[${index}].id`, message: 'identifiant de bloc requis' });
      return;
    }
    if (blockIds.has(id)) {
      issues.push({ path: `blocks[${index}].id`, message: `identifiant de bloc dupliqué "${id}"` });
      return;
    }
    blockIds.add(id);

    if (
      block.blockType === 'ROUND_ROBIN' &&
      (typeof block.config.roundIndex !== 'number' || !Number.isFinite(block.config.roundIndex))
    ) {
      issues.push({
        path: `blocks[${index}].roundIndex`,
        message: 'roundIndex requis pour un bloc ROUND_ROBIN',
      });
    }
  });

  if (format.blocks.length === 0) {
    issues.push({ path: 'blocks', message: 'au moins un bloc est requis' });
  }
  if (!format.entryBlockId) {
    issues.push({ path: 'entryBlockId', message: "bloc d'entrée requis" });
  } else if (!blockIds.has(format.entryBlockId)) {
    issues.push({ path: 'entryBlockId', message: `bloc d'entrée introuvable "${format.entryBlockId}"` });
  }

  const connectorIds = new Set<string>();
  format.connectors.forEach((connector, index) => {
    if (!connector.id.trim()) {
      issues.push({ path: `connectors[${index}].id`, message: 'identifiant de connecteur requis' });
    } else if (connectorIds.has(connector.id)) {
      issues.push({
        path: `connectors[${index}].id`,
        message: `identifiant de connecteur dupliqué "${connector.id}"`,
      });
    } else {
      connectorIds.add(connector.id);
    }

    if (!blockIds.has(connector.sourceBlockId)) {
      issues.push({
        path: `connectors[${index}].sourceBlockId`,
        message: `bloc source introuvable "${connector.sourceBlockId}"`,
      });
    }
    if (!blockIds.has(connector.targetBlockId)) {
      issues.push({
        path: `connectors[${index}].targetBlockId`,
        message: `bloc cible introuvable "${connector.targetBlockId}"`,
      });
    }
    if (connector.sourceBlockId === connector.targetBlockId) {
      issues.push({
        path: `connectors[${index}]`,
        message: 'un connecteur ne peut pas relier un bloc à lui-même',
      });
    }
  });

  if (format.teams.length < 2) {
    issues.push({ path: 'teams', message: 'au moins 2 équipes sont requises' });
  }

  const teamIds = new Set<string>();
  format.teams.forEach((team, index) => {
    if (!team.id.trim()) {
      issues.push({ path: `teams[${index}].id`, message: 'identifiant requis' });
      return;
    }
    if (teamIds.has(team.id)) {
      issues.push({ path: `teams[${index}].id`, message: `équipe dupliquée "${team.id}"` });
      return;
    }
    teamIds.add(team.id);
  });

  return issues;
}

/** Format « vierge » : un bloc suisse et 4 équipes, prêt à être personnalisé. */
export function emptyTournamentFormat(meta: TournamentFormatMeta): TournamentFormat {
  const teams: TeamBase[] = Array.from({ length: 4 }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Équipe ${index + 1}`,
    initialSeed: index + 1,
  }));
  const blocks: FormatBlockDefinition[] = [
    { blockType: 'SWISS', config: { id: 'swiss-1', stageId: 'swiss', roundNumber: 1 } },
  ];
  return {
    version: '1.0.0',
    id: meta.id,
    name: meta.name,
    description: meta.description ?? '',
    prngSeed: 42,
    pointsConfig: { ...DEFAULT_POINTS_CONFIG },
    entryBlockId: 'swiss-1',
    teams,
    blocks,
    connectors: [],
  };
}

/** Clone profond et sûr d'un format (les formats sont purement JSON). */
export function cloneFormat(format: TournamentFormat): TournamentFormat {
  return structuredClone(format);
}

export function defaultPointsConfig(): PointsConfig {
  return { ...DEFAULT_POINTS_CONFIG };
}

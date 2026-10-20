import type {
  ConnectorConfig,
  FilterRuleDSL,
  FormatBlockDefinition,
  RankingCriterion,
  SeedingTransform,
  SkipConditionDSL,
  StatsResetPolicy,
  TeamBase,
  TournamentFormat,
  TransferMode,
} from '../../../../src/index';

export const BLOCK_TYPES: Array<{ value: FormatBlockDefinition['blockType']; label: string }> = [
  { value: 'SWISS', label: 'Suisse' },
  { value: 'BRACKET', label: 'Tableau (bracket)' },
  { value: 'ROUND_ROBIN', label: 'Toutes rondes' },
  { value: 'MERGER', label: 'Fusion (merger)' },
];

export const RANKING_CRITERIA: RankingCriterion[] = [
  'points',
  'buchholzScore',
  'scoreDifference',
  'wins',
  'headToHead',
  'initialSeed',
];

export const FILTER_TYPES: Array<{ value: FilterRuleDSL['type']; label: string }> = [
  { value: 'ALL', label: 'Toutes les équipes' },
  { value: 'WINNERS', label: 'Vainqueurs' },
  { value: 'LOSERS', label: 'Perdants' },
  { value: 'TOP_N', label: 'Top N' },
  { value: 'BOTTOM_N', label: 'Bas de tableau N' },
  { value: 'RANGE', label: 'Plage de rangs' },
  { value: 'MIN_POINTS', label: 'Points minimum' },
  { value: 'EXACT_WINS', label: 'Exactement N victoires' },
  { value: 'EXACT_LOSSES', label: 'Exactement N défaites' },
];

export const SKIP_TYPES: Array<{ value: SkipConditionDSL['type']; label: string }> = [
  { value: 'NEVER', label: 'Jamais' },
  {
    value: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED',
    label: 'Si une équipe du connecteur est invaincue',
  },
  { value: 'SKIP_IF_FEWER_TEAMS_THAN', label: "Si moins de N équipes" },
  { value: 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS', label: 'Si toutes les équipes ont N victoires' },
];

export const TRANSFER_MODES: Array<{ value: TransferMode; label: string }> = [
  { value: 'BATCH', label: 'BATCH (tous les qualifiés ensemble)' },
  { value: 'STREAMING', label: 'STREAMING (au fil des matchs)' },
];

export const STATS_RESET_POLICIES: Array<{ value: StatsResetPolicy; label: string }> = [
  { value: 'KEEP_ALL', label: 'Conserver les statistiques' },
  { value: 'ARCHIVE_AND_RESET_ALL', label: 'Archiver puis remettre à zéro' },
  { value: 'RESET_POINTS_KEEP_HISTORY', label: 'Reset points, garder l’historique' },
];

export const SEEDING_TRANSFORMS: Array<{ value: SeedingTransform; label: string }> = [
  { value: 'KEEP', label: 'Conserver' },
  { value: 'REVERSE', label: 'Inverser' },
  { value: 'SHUFFLE', label: 'Mélanger (PRNG)' },
  { value: 'CROSS_OVER', label: 'Croisement' },
  { value: 'SNAKE', label: 'Serpentin (snake)' },
];

export const POINTS_FIELDS: Array<{ key: keyof TournamentFormat['pointsConfig']; label: string }> = [
  { key: 'win', label: 'Victoire' },
  { key: 'draw', label: 'Nul' },
  { key: 'loss', label: 'Défaite' },
  { key: 'bye', label: 'Bye' },
  { key: 'forfeitWinScore', label: 'Forfait gagné' },
  { key: 'forfeitLossScore', label: 'Forfait perdu' },
];

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normaliseSeeds(teams: TeamBase[]): TeamBase[] {
  return teams.map((team, index) => ({ ...team, initialSeed: index + 1 }));
}

export function uniqueId(prefix: string, existing: string[]): string {
  let index = existing.length + 1;
  let candidate = `${prefix}-${index}`;
  while (existing.includes(candidate)) {
    index += 1;
    candidate = `${prefix}-${index}`;
  }
  return candidate;
}

export function defaultFilterRule(type: FilterRuleDSL['type']): FilterRuleDSL {
  switch (type) {
    case 'WINNERS':
      return { type: 'WINNERS' };
    case 'LOSERS':
      return { type: 'LOSERS' };
    case 'TOP_N':
      return { type: 'TOP_N', count: 4 };
    case 'BOTTOM_N':
      return { type: 'BOTTOM_N', count: 4 };
    case 'RANGE':
      return { type: 'RANGE', startRank: 1, endRank: 4 };
    case 'MIN_POINTS':
      return { type: 'MIN_POINTS', points: 3 };
    case 'EXACT_WINS':
      return { type: 'EXACT_WINS', wins: 1 };
    case 'EXACT_LOSSES':
      return { type: 'EXACT_LOSSES', losses: 1 };
    case 'ALL':
    default:
      return { type: 'ALL' };
  }
}

export function defaultSkipCondition(
  type: SkipConditionDSL['type'],
  connectorId: string,
): SkipConditionDSL {
  switch (type) {
    case 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED':
      return { type, connectorId };
    case 'SKIP_IF_FEWER_TEAMS_THAN':
      return { type, minTeams: 2 };
    case 'SKIP_IF_ALL_TEAMS_HAVE_MIN_WINS':
      return { type, wins: 1 };
    case 'NEVER':
    default:
      return { type: 'NEVER' };
  }
}

export function createBlock(id: string): FormatBlockDefinition {
  return {
    blockType: 'SWISS',
    config: { id, stageId: 'swiss', roundNumber: 1 },
  };
}

export function createConnector(
  existingIds: string[],
  sourceBlockId: string,
  targetBlockId: string,
): ConnectorConfig {
  return {
    id: uniqueId('conn', existingIds),
    sourceBlockId,
    targetBlockId,
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
  };
}

export function blockTypeLabel(type: FormatBlockDefinition['blockType']): string {
  return BLOCK_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** Résumé compact affiché sous l'identifiant dans la mindmap. */
export function blockMeta(block: FormatBlockDefinition): string {
  const config = block.config;
  const parts: string[] = [];
  const stage = asString(config.stageId);
  if (stage) parts.push(stage);

  if (block.blockType === 'ROUND_ROBIN') {
    parts.push(`Journée ${asNumber(config.roundIndex, 0)}`);
  } else {
    const round = asNumber(config.roundNumber, 0);
    if (round > 0) parts.push(`R${round}`);
  }

  if (block.blockType === 'BRACKET' && config.expectedSlots !== undefined) {
    parts.push(`${asNumber(config.expectedSlots, 0)} slots`);
  }

  return parts.join(' · ') || 'Sans stage';
}

/** Libellé très court du filtre, pour les étiquettes d'arêtes. */
export function filterLabel(rule: FilterRuleDSL): string {
  switch (rule.type) {
    case 'WINNERS':
      return 'Vainqueurs';
    case 'LOSERS':
      return 'Perdants';
    case 'TOP_N':
      return `Top ${rule.count}`;
    case 'BOTTOM_N':
      return `Bas ${rule.count}`;
    case 'RANGE':
      return `Rangs ${rule.startRank}–${rule.endRank}`;
    case 'MIN_POINTS':
      return `≥ ${rule.points} pts`;
    case 'EXACT_WINS':
      return `${rule.wins} vict.`;
    case 'EXACT_LOSSES':
      return `${rule.losses} déf.`;
    case 'ALL':
    default:
      return 'Tous';
  }
}

export function renameBlockId(
  format: TournamentFormat,
  index: number,
  nextId: string,
): TournamentFormat {
  const previousId = asString(format.blocks[index]?.config.id);
  return {
    ...format,
    blocks: format.blocks.map((entry, blockIndex) =>
      blockIndex === index ? { ...entry, config: { ...entry.config, id: nextId } } : entry,
    ),
    connectors: format.connectors.map((connector) => ({
      ...connector,
      sourceBlockId:
        connector.sourceBlockId === previousId ? nextId : connector.sourceBlockId,
      targetBlockId:
        connector.targetBlockId === previousId ? nextId : connector.targetBlockId,
    })),
    entryBlockId: format.entryBlockId === previousId ? nextId : format.entryBlockId,
  };
}

export function renameConnectorId(
  format: TournamentFormat,
  index: number,
  nextId: string,
): TournamentFormat {
  const previousId = format.connectors[index]?.id;
  return {
    ...format,
    connectors: format.connectors.map((connector, connectorIndex) =>
      connectorIndex === index ? { ...connector, id: nextId } : connector,
    ),
    blocks: format.blocks.map((block) => {
      const skip = block.config.skipCondition as SkipConditionDSL | undefined;
      if (
        skip?.type === 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED' &&
        skip.connectorId === previousId
      ) {
        return {
          ...block,
          config: {
            ...block.config,
            skipCondition: { ...skip, connectorId: nextId },
          },
        };
      }
      return block;
    }),
  };
}

export function removeBlock(format: TournamentFormat, index: number): TournamentFormat {
  const removedId = asString(format.blocks[index]?.config.id);
  const blocks = format.blocks.filter((_, blockIndex) => blockIndex !== index);
  const removedConnectors = format.connectors.filter(
    (connector) =>
      connector.sourceBlockId === removedId || connector.targetBlockId === removedId,
  );
  return clearSkipReferences(
    {
      ...format,
      blocks,
      connectors: format.connectors.filter(
        (connector) =>
          connector.sourceBlockId !== removedId && connector.targetBlockId !== removedId,
      ),
      entryBlockId:
        format.entryBlockId === removedId
          ? asString(blocks[0]?.config.id)
          : format.entryBlockId,
    },
    removedConnectors.map((connector) => connector.id),
  );
}

export function removeConnector(format: TournamentFormat, index: number): TournamentFormat {
  const removed = format.connectors[index];
  return clearSkipReferences(
    {
      ...format,
      connectors: format.connectors.filter(
        (_, connectorIndex) => connectorIndex !== index,
      ),
    },
    removed ? [removed.id] : [],
  );
}

/** Remet à `NEVER` les court-circuits qui référencent un connecteur supprimé. */
function clearSkipReferences(
  format: TournamentFormat,
  removedConnectorIds: string[],
): TournamentFormat {
  if (removedConnectorIds.length === 0) return format;
  const removed = new Set(removedConnectorIds);
  let changed = false;
  const blocks = format.blocks.map((block) => {
    const skip = block.config.skipCondition as SkipConditionDSL | undefined;
    if (
      skip?.type === 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED' &&
      removed.has(skip.connectorId)
    ) {
      changed = true;
      return {
        ...block,
        config: { ...block.config, skipCondition: { type: 'NEVER' as const } },
      };
    }
    return block;
  });
  return changed ? { ...format, blocks } : format;
}

export function duplicateConnector(
  format: TournamentFormat,
  index: number,
): ConnectorConfig | null {
  const source = format.connectors[index];
  if (!source) return null;
  const copy = structuredClone(source);
  copy.id = uniqueId(
    'conn',
    format.connectors.map((connector) => connector.id),
  );
  return copy;
}

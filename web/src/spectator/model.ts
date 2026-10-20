import type {
  BlockState,
  ConnectorConfig,
  EnrichedTeam,
  Match,
  ParticipantSlot,
} from '../../../src/index';
import type { BlockView } from '../store/tournamentStore';

export type StageKind = 'swiss' | 'round-robin' | 'bracket' | 'merger' | 'mixed';

export interface StageGroup {
  id: string;
  label: string;
  kind: StageKind;
  blocks: BlockView[];
  connectors: ConnectorConfig[];
}

export interface FormatInfo {
  label: string;
  description: string;
  tone: 'swiss' | 'bracket' | 'round-robin' | 'mixed';
}

const STAGE_LABELS: Record<string, string> = {
  swiss: 'Phase suisse',
  playoffs: 'Phase finale',
  playoff: 'Phase finale',
  final: 'Phase finale',
  finals: 'Phase finale',
  de: 'Élimination directe',
  'double-elim': 'Double élimination',
  'double-elimination': 'Double élimination',
  rr: 'Toutes rondes',
  'round-robin': 'Toutes rondes',
  groups: 'Phase de poules',
  group: 'Phase de poules',
  main: 'Phase principale',
  bracket: 'Tableau final',
};

const BLOCK_STATE_LABEL: Record<BlockState, string> = {
  PENDING: 'À venir',
  SKIPPED: 'Non joué',
  SEEDING_AND_PAIRING: 'Appariements',
  IN_PROGRESS: 'En cours',
  RESOLVING: 'Résolution',
  COMPLETED: 'Terminé',
};

export function blockStateLabel(state: BlockState): string {
  return BLOCK_STATE_LABEL[state];
}

export function isBlockDone(block: BlockView): boolean {
  return block.state === 'COMPLETED' || block.state === 'SKIPPED';
}

export function prettyStageLabel(stageId: string): string {
  const known = STAGE_LABELS[stageId.toLowerCase()];
  if (known) return known;
  return stageId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageKind(blocks: BlockView[]): StageKind {
  const types = new Set(blocks.map((block) => block.type));
  if (types.size === 1) {
    const only = blocks[0]?.type;
    if (only === 'SWISS') return 'swiss';
    if (only === 'ROUND_ROBIN') return 'round-robin';
    if (only === 'BRACKET') return 'bracket';
    if (only === 'MERGER') return 'merger';
  }
  return 'mixed';
}

/**
 * Regroupe les blocs en phases lisibles par un spectateur.
 *
 * Les blocs qui partagent un `stageId` forment une phase. Les blocs sans
 * stageId explicite sont regroupés par type, ce qui garde les rondes suisses
 * ou les journées toutes rondes dans une seule section.
 */
export function buildStages(blocks: BlockView[], connectors: ConnectorConfig[]): StageGroup[] {
  const groups = new Map<string, { id: string; label: string; blocks: BlockView[] }>();
  const order: string[] = [];

  for (const block of blocks) {
    const explicit = typeof block.config.stageId === 'string' ? block.config.stageId : undefined;
    const id = explicit ?? `auto:${block.type}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: explicit ? prettyStageLabel(explicit) : defaultStageLabel(block.type),
        blocks: [],
      };
      groups.set(id, group);
      order.push(id);
    }
    group.blocks.push(block);
  }

  return order.map((id) => {
    const group = groups.get(id)!;
    const blockIds = new Set(group.blocks.map((block) => block.id));
    return {
      id: group.id,
      label: group.label,
      kind: stageKind(group.blocks),
      blocks: group.blocks,
      connectors: connectors.filter(
        (connector) =>
          blockIds.has(connector.sourceBlockId) || blockIds.has(connector.targetBlockId),
      ),
    };
  });
}

function defaultStageLabel(type: string): string {
  if (type === 'SWISS') return 'Phase suisse';
  if (type === 'ROUND_ROBIN') return 'Toutes rondes';
  if (type === 'BRACKET') return 'Tableau final';
  if (type === 'MERGER') return 'Fusion';
  return 'Phase';
}

export function formatInfo(blocks: BlockView[], connectors: ConnectorConfig[]): FormatInfo {
  const types = new Set(blocks.map((block) => block.type));
  const hasSwiss = types.has('SWISS');
  const hasBracket = types.has('BRACKET');
  const hasRoundRobin = types.has('ROUND_ROBIN');
  const doubleElimination = connectors.some(
    (connector) => connector.filterRule.type === 'LOSERS',
  );
  const swissRounds = blocks.filter((block) => block.type === 'SWISS').length;
  const rrDays = blocks.filter((block) => block.type === 'ROUND_ROBIN').length;

  if (doubleElimination) {
    return {
      label: 'Double élimination',
      description:
        'Tableau des gagnants, tableau des perdants puis grande finale — une seconde chance avant l’élimination.',
      tone: 'bracket',
    };
  }
  if (hasSwiss && hasBracket) {
    return {
      label: 'Système suisse + phase finale',
      description: `${swissRounds} ronde${swissRounds > 1 ? 's' : ''} suisse${
        swissRounds > 1 ? 's' : ''
      } pour désigner les qualifiés, puis tableau à élimination directe.`,
      tone: 'mixed',
    };
  }
  if (hasRoundRobin && hasBracket) {
    return {
      label: 'Toutes rondes + phase finale',
      description: `${rrDays} journée${rrDays > 1 ? 's' : ''} de round robin, suivies d’un tableau final.`,
      tone: 'mixed',
    };
  }
  if (hasBracket) {
    return {
      label: 'Élimination directe',
      description: 'Chaque match est décisif : le vainqueur avance, le perdant quitte le tournoi.',
      tone: 'bracket',
    };
  }
  if (hasSwiss) {
    return {
      label: 'Système suisse',
      description: `${swissRounds} ronde${
        swissRounds > 1 ? 's' : ''
      } sans élimination : les équipes affrontent des adversaires de niveau comparable.`,
      tone: 'swiss',
    };
  }
  if (hasRoundRobin) {
    return {
      label: 'Toutes rondes',
      description: `${rrDays} journée${rrDays > 1 ? 's' : ''} : chaque équipe rencontre toutes les autres.`,
      tone: 'round-robin',
    };
  }
  return {
    label: 'Tournoi multi-phases',
    description: 'Plusieurs phases s’enchaînent, avec qualification des meilleures équipes.',
    tone: 'mixed',
  };
}

export function participantIds(block: BlockView): string[] {
  const ids = new Set<string>([...block.inputTeamIds, ...block.outputTeamIds]);
  for (const match of block.matches) {
    if (match.slotA.type === 'RESOLVED') ids.add(match.slotA.teamId);
    if (match.slotB.type === 'RESOLVED') ids.add(match.slotB.teamId);
  }
  return [...ids];
}

export function teamName(teams: Record<string, EnrichedTeam>, teamId: string | undefined): string {
  if (!teamId) return 'Équipe inconnue';
  return teams[teamId]?.name ?? teamId;
}

export function teamSeed(teams: Record<string, EnrichedTeam>, teamId: string | undefined): number | null {
  if (!teamId) return null;
  return teams[teamId]?.currentSeed ?? null;
}

export function slotTeamId(slot: ParticipantSlot): string | undefined {
  return slot.type === 'RESOLVED' ? slot.teamId : undefined;
}

export function slotText(
  slot: ParticipantSlot,
  resolvePointer: (slot: Extract<ParticipantSlot, { type: 'PENDING_POINTER' }>) => string,
): string {
  if (slot.type === 'BYE') return 'Exempt';
  if (slot.type === 'RESOLVED') return slot.teamId;
  return resolvePointer(slot);
}

export function resultLabel(match: Match): string {
  if (match.state === 'COMPLETED') {
    if (match.winnerId === 'DRAW') return 'Match nul';
    return 'Terminé';
  }
  if (match.state === 'READY') return 'Prêt à jouer';
  if (match.state === 'SKIPPED') return 'Non joué';
  return 'En attente';
}

export function matchScore(match: Match): { a: string; b: string } {
  return {
    a: match.scoreA === undefined ? '–' : String(match.scoreA),
    b: match.scoreB === undefined ? '–' : String(match.scoreB),
  };
}

export function winnerSide(match: Match): 'A' | 'B' | null {
  const a = slotTeamId(match.slotA);
  const b = slotTeamId(match.slotB);
  if (!match.winnerId || match.winnerId === 'DRAW' || match.winnerId === 'BYE') return null;
  if (match.winnerId === a) return 'A';
  if (match.winnerId === b) return 'B';
  return null;
}

export function stageStatus(stage: StageGroup): 'upcoming' | 'live' | 'done' {
  const done = stage.blocks.filter(isBlockDone).length;
  if (done === stage.blocks.length) return 'done';
  if (stage.blocks.some((block) => block.state !== 'PENDING' && !isBlockDone(block))) return 'live';
  return 'upcoming';
}

export function stageRoundLabel(stage: StageGroup, block: BlockView): string {
  if (stage.kind === 'round-robin') return `Journée ${block.roundNumber}`;
  if (stage.kind === 'swiss') return `Ronde ${block.roundNumber}`;
  return `Tour ${block.roundNumber}`;
}

export function knockoutColumnLabel(remainingRounds: number): string {
  if (remainingRounds <= 1) return 'Finale';
  if (remainingRounds === 2) return 'Demi-finales';
  if (remainingRounds === 3) return 'Quarts de finale';
  if (remainingRounds === 4) return 'Huitièmes de finale';
  return `Tour des ${2 ** remainingRounds}`;
}

export function shortRoundLabel(remainingRounds: number): string {
  if (remainingRounds <= 1) return 'Finale';
  if (remainingRounds === 2) return 'Demi-finale';
  if (remainingRounds === 3) return 'Quart';
  if (remainingRounds === 4) return 'Huitième';
  return `Tour ${remainingRounds}`;
}

export function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count > 1 ? pluralForm : singular;
}

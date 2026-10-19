import type { Match, TeamBase, TournamentGraph } from '../src/index';
import teams4Json from './fixtures/teams-4.json';
import teams8Json from './fixtures/teams-8.json';

const fixtures = {
  'teams-4': teams4Json,
  'teams-8': teams8Json,
} as const;

export type FixtureName = keyof typeof fixtures;

/** Charge une copie isolée d'un jeu d'équipes de test. */
export function loadTeams(name: FixtureName): TeamBase[] {
  return structuredClone(fixtures[name]) as TeamBase[];
}

export function resolvedId(slot: Match['slotA']): string | undefined {
  return slot.type === 'RESOLVED' ? slot.teamId : undefined;
}

export function matchTeamIds(match: Match): string[] {
  return [resolvedId(match.slotA), resolvedId(match.slotB)].filter(
    (id): id is string => id !== undefined,
  );
}

/** Joue tous les matchs READY d'un bloc (ou de tout le graphe) sur un score 2-0. */
export function playAllReady(graph: TournamentGraph, blockId?: string): void {
  for (const match of graph.getPlayableMatches(blockId)) {
    graph.reportMatchResult(match.id, { scoreA: 2, scoreB: 0 });
  }
}

import {
  BracketRoundBlock,
  RoundRobinStageMacro,
  SwissRoundBlock,
  TournamentGraph,
  type TeamBase,
} from '../../../src/index';
import teams4Json from '../../../tests/fixtures/teams-4.json';
import teams8Json from '../../../tests/fixtures/teams-8.json';

const teams4 = teams4Json as TeamBase[];
const teams8 = teams8Json as TeamBase[];

export type ScenarioId = 'swiss-topcut-8' | 'double-elim-4' | 'round-robin-4' | 'swiss-fresh-8';

export interface ScenarioMeta {
  id: ScenarioId;
  name: string;
  description: string;
  teamCount: number;
}

export const SCENARIOS: ScenarioMeta[] = [
  {
    id: 'swiss-topcut-8',
    name: 'Suisse (2 rondes jouées) → Top Cut 4',
    description:
      '8 équipes, 3 rondes suisses puis demi-finales et finale. Deux rondes sont pré-jouées.',
    teamCount: 8,
  },
  {
    id: 'swiss-fresh-8',
    name: 'Suisse 8 équipes (à démarrer)',
    description: '8 équipes seedées, tournoi non démarré : idéal pour tester le lancement.',
    teamCount: 8,
  },
  {
    id: 'double-elim-4',
    name: 'Double élimination (4) en streaming',
    description:
      'Winner/Loser brackets en propagation STREAMING + Grande Finale et Bracket Reset.',
    teamCount: 4,
  },
  {
    id: 'round-robin-4',
    name: 'Toutes rondes (4) — 1 journée jouée',
    description: 'Polygone de Berger sur 3 journées.',
    teamCount: 4,
  },
];

export function scenarioMeta(id: ScenarioId): ScenarioMeta {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0];
}

/** Déroule les matchs READY d'un bloc (ou de tout le graphe), seed le plus fort gagnant. */
function playReady(graph: TournamentGraph, blockId?: string, limit = Number.POSITIVE_INFINITY): number {
  let played = 0;
  while (played < limit) {
    const ready = graph.getPlayableMatches(blockId);
    if (ready.length === 0) break;
    const match = ready[0];
    graph.reportMatchResult(match.id, { scoreA: 2, scoreB: 0 });
    played += 1;
  }
  return played;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function buildSwissTopCut(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 2024 });
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-1', stageId: 'swiss', roundNumber: 1 }));
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-2', stageId: 'swiss', roundNumber: 2 }));
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-3', stageId: 'swiss', roundNumber: 3 }));
  graph.addBlock(new BracketRoundBlock({ id: 'semis', stageId: 'playoffs', roundNumber: 1 }));
  graph.addBlock(new BracketRoundBlock({ id: 'final', stageId: 'playoffs', roundNumber: 2 }));

  graph.connect('swiss-1', 'swiss-2', {
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'swiss',
  });
  graph.connect('swiss-2', 'swiss-3', {
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'swiss',
  });
  graph.connect('swiss-3', 'semis', {
    transferMode: 'BATCH',
    filterRule: { type: 'TOP_N', count: 4 },
    statsResetPolicy: 'ARCHIVE_AND_RESET_ALL',
    targetStageId: 'playoffs',
  });
  graph.connect('semis', 'final', {
    transferMode: 'BATCH',
    filterRule: { type: 'WINNERS' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'playoffs',
  });

  graph.seedTeams(clone(teams8), 'swiss-1');
  graph.start();
  playReady(graph, 'swiss-1');
  playReady(graph, 'swiss-2');
  return graph;
}

function buildSwissFresh(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 7 });
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-1', stageId: 'swiss', roundNumber: 1 }));
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-2', stageId: 'swiss', roundNumber: 2 }));
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-3', stageId: 'swiss', roundNumber: 3 }));
  graph.connect('swiss-1', 'swiss-2', {
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'swiss',
  });
  graph.connect('swiss-2', 'swiss-3', {
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'swiss',
  });
  graph.seedTeams(clone(teams8), 'swiss-1');
  return graph;
}

function buildDoubleElim(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 11 });
  graph.addBlock(new BracketRoundBlock({ id: 'wb-r1', stageId: 'de', roundNumber: 1 }));
  graph.addBlock(new BracketRoundBlock({ id: 'wb-final', stageId: 'de', roundNumber: 2 }));
  graph.addBlock(new BracketRoundBlock({ id: 'lb-r1', stageId: 'de', roundNumber: 2 }));
  graph.addBlock(new BracketRoundBlock({ id: 'lb-final', stageId: 'de', roundNumber: 3 }));
  graph.addBlock(new BracketRoundBlock({ id: 'gf-1', stageId: 'de', roundNumber: 4 }));
  graph.addBlock(
    new BracketRoundBlock({
      id: 'bracket-reset',
      stageId: 'de',
      roundNumber: 5,
      skipCondition: { type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED', connectorId: 'upper-final-conn' },
    }),
  );

  const streaming = {
    transferMode: 'STREAMING' as const,
    statsResetPolicy: 'KEEP_ALL' as const,
    targetStageId: 'de',
  };
  graph.connect('wb-r1', 'wb-final', {
    id: 'wb-winners-conn',
    ...streaming,
    filterRule: { type: 'WINNERS' },
  });
  graph.connect('wb-r1', 'lb-r1', {
    id: 'wb-losers-conn',
    ...streaming,
    filterRule: { type: 'LOSERS' },
  });
  graph.connect('wb-final', 'gf-1', {
    id: 'upper-final-conn',
    ...streaming,
    filterRule: { type: 'WINNERS' },
  });
  graph.connect('wb-final', 'lb-final', {
    id: 'wb-final-loser-conn',
    ...streaming,
    filterRule: { type: 'LOSERS' },
  });
  graph.connect('lb-r1', 'lb-final', {
    id: 'lb-winner-conn',
    ...streaming,
    filterRule: { type: 'WINNERS' },
  });
  graph.connect('lb-final', 'gf-1', {
    id: 'lower-final-conn',
    ...streaming,
    filterRule: { type: 'WINNERS' },
  });
  graph.connect('gf-1', 'bracket-reset', {
    id: 'gf1-to-reset-conn',
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
    targetStageId: 'de',
  });

  graph.seedTeams(clone(teams4), 'wb-r1');
  graph.start();
  playReady(graph, 'wb-r1');
  return graph;
}

function buildRoundRobin(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 5 });
  const stage = RoundRobinStageMacro.createStage('rr', 4);
  graph.addBlocks(stage.blocks);
  for (const connector of stage.connectors) {
    graph.connect(connector.sourceBlockId, connector.targetBlockId, {
      id: connector.id,
      transferMode: connector.transferMode,
      filterRule: connector.filterRule,
      statsResetPolicy: connector.statsResetPolicy,
      targetStageId: connector.targetStageId,
    });
  }
  graph.seedTeams(clone(teams4), stage.blocks[0].id);
  graph.start();
  playReady(graph, stage.blocks[0].id);
  return graph;
}

export function buildScenario(id: ScenarioId): TournamentGraph {
  switch (id) {
    case 'swiss-topcut-8':
      return buildSwissTopCut();
    case 'swiss-fresh-8':
      return buildSwissFresh();
    case 'double-elim-4':
      return buildDoubleElim();
    case 'round-robin-4':
      return buildRoundRobin();
    default:
      return buildSwissTopCut();
  }
}

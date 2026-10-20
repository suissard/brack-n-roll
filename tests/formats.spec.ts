import { describe, expect, it } from 'vitest';
import {
  BracketRoundBlock,
  SwissRoundBlock,
  TournamentGraph,
  createGraphFromFormat,
  emptyTournamentFormat,
  validateTournamentFormat,
  type TournamentFormat,
} from '../src/index';
import { loadTeams, matchTeamIds, playAllReady } from './helpers';

const teams8 = loadTeams('teams-8');

function buildFormatSource(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 77 });
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-1', stageId: 'swiss', roundNumber: 1 }));
  graph.addBlock(new SwissRoundBlock({ id: 'swiss-2', stageId: 'swiss', roundNumber: 2 }));
  graph.addBlock(new BracketRoundBlock({ id: 'semis', stageId: 'playoffs', roundNumber: 1 }));
  graph.addBlock(new BracketRoundBlock({ id: 'final', stageId: 'playoffs', roundNumber: 2 }));

  const batch = {
    transferMode: 'BATCH' as const,
    filterRule: { type: 'TOP_N' as const, count: 4 },
    statsResetPolicy: 'ARCHIVE_AND_RESET_ALL' as const,
    targetStageId: 'playoffs',
  };
  graph.connect('swiss-1', 'swiss-2', {
    id: 'swiss-1-swiss-2',
    transferMode: 'BATCH',
    filterRule: { type: 'ALL' },
    statsResetPolicy: 'KEEP_ALL',
  });
  graph.connect('swiss-2', 'semis', { id: 'swiss-2-semis', ...batch });
  graph.connect('semis', 'final', {
    id: 'semis-final',
    transferMode: 'STREAMING',
    filterRule: { type: 'WINNERS' },
    statsResetPolicy: 'KEEP_ALL',
  });

  graph.seedTeams(teams8, 'swiss-1');
  graph.start();
  playAllReady(graph, 'swiss-1');
  return graph;
}

describe('Formats déclaratifs', () => {
  it('exporte la topologie et le seeding sans la timeline', () => {
    const graph = buildFormatSource();
    const format = graph.toFormat({ id: 'fmt-test', name: 'Suisse + playoffs' });

    expect(format.version).toBe('1.0.0');
    expect(format.id).toBe('fmt-test');
    expect(format.blocks.map((block) => block.config.id)).toEqual([
      'swiss-1',
      'swiss-2',
      'semis',
      'final',
    ]);
    expect(format.connectors).toHaveLength(3);
    expect(format.teams).toHaveLength(8);
    expect(format.entryBlockId).toBe('swiss-1');
    expect(format.prngSeed).toBe(77);
    expect(validateTournamentFormat(format)).toEqual([]);
  });

  it('reconstruit un tournoi jouable depuis un format', () => {
    const format = buildFormatSource().toFormat({ id: 'fmt-test', name: 'Suisse + playoffs' });
    const rebuilt = createGraphFromFormat(format, { autoStart: true });

    expect(rebuilt.getBlocks().map((block) => block.id)).toEqual([
      'swiss-1',
      'swiss-2',
      'semis',
      'final',
    ]);
    expect(rebuilt.registry.getAllTeams()).toHaveLength(8);
    expect(rebuilt.getPlayableMatches()).toHaveLength(4);
    expect(
      rebuilt.timeMachine.getTimeline().some((event) => event.payload.type === 'TEAMS_SEEDED'),
    ).toBe(true);
    expect(
      rebuilt.timeMachine.getTimeline().some((event) => event.payload.type === 'TOURNAMENT_STARTED'),
    ).toBe(true);
  });

  it('produit le même seeding que la graine PRNG d’origine', () => {
    const format = buildFormatSource().toFormat({ id: 'fmt-test', name: 'Suisse + playoffs' });
    const first = createGraphFromFormat(format, { autoStart: true });
    const second = createGraphFromFormat(format, { autoStart: true });

    const pair = (graph: TournamentGraph) =>
      graph
        .getPlayableMatches()
        .map((match) => matchTeamIds(match).slice().sort().join(' vs '))
        .sort();

    expect(pair(first)).toEqual(pair(second));
    expect(pair(first)).toHaveLength(4);
  });

  it('crée un format vierge valide', () => {
    const format = emptyTournamentFormat({ id: 'blank', name: 'Vierge' });
    expect(format.blocks).toHaveLength(1);
    expect(format.teams).toHaveLength(4);
    expect(validateTournamentFormat(format)).toEqual([]);
    expect(createGraphFromFormat(format, { autoStart: true }).getPlayableMatches()).toHaveLength(2);
  });

  it('signale les incohérences de topologie', () => {
    const format: TournamentFormat = emptyTournamentFormat({ id: 'broken', name: 'Cassé' });
    format.entryBlockId = 'inexistant';
    format.blocks.push({
      blockType: 'SWISS',
      config: { id: 'swiss-1', stageId: 'swiss' },
    });
    format.connectors.push({
      id: 'conn-1',
      sourceBlockId: 'swiss-1',
      targetBlockId: 'swiss-1',
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
    });
    format.connectors.push({
      id: 'conn-1',
      sourceBlockId: 'ghost',
      targetBlockId: 'swiss-1',
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
    });

    const issues = validateTournamentFormat(format);
    const messages = issues.map((issue) => issue.message).join(' | ');
    expect(messages).toContain('bloc dupliqué');
    expect(messages).toContain("bloc d'entrée introuvable");
    expect(messages).toContain('lui-même');
    expect(messages).toContain('connecteur dupliqué');
    expect(messages).toContain('bloc source introuvable');
    expect(() => createGraphFromFormat(format)).toThrow();
  });
});

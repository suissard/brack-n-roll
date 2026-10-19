import { describe, expect, it } from 'vitest';
import {
  BracketRoundBlock,
  DeterministicPRNG,
  MergerBlock,
  RoundRobinStageMacro,
  StateHasher,
  StandingsCalculator,
  SwissRoundBlock,
  TournamentGraph,
  type EnrichedTeam,
} from '../src/index';
import { loadTeams, playAllReady, resolvedId } from './helpers';

const teams4 = loadTeams('teams-4');
const teams8 = loadTeams('teams-8');

describe('DeterministicPRNG', () => {
  it('produit la même séquence pour une même graine', () => {
    const a = new DeterministicPRNG(12345);
    const b = new DeterministicPRNG(12345);
    for (let i = 0; i < 50; i++) {
      expect(a.nextFloat()).toBe(b.nextFloat());
    }
  });

  it('respecte les bornes de nextInt et ne mute pas le tableau de shuffle', () => {
    const prng = new DeterministicPRNG(42);
    for (let i = 0; i < 200; i++) {
      const value = prng.nextInt(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
    const input = [1, 2, 3, 4, 5];
    const snapshot = input.slice();
    const shuffled = prng.shuffle(input);
    expect(input).toEqual(snapshot);
    expect(shuffled.slice().sort()).toEqual(snapshot);
  });
});

describe('StateHasher', () => {
  it("est indépendant de l'ordre des clés", () => {
    const a = StateHasher.computeHash({ x: 1, y: { b: 2, a: 3 } });
    const b = StateHasher.computeHash({ y: { a: 3, b: 2 }, x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('distingue des états différents', () => {
    expect(StateHasher.computeHash({ x: 1 })).not.toBe(StateHasher.computeHash({ x: 2 }));
  });
});

describe('StandingsCalculator', () => {
  it('trie par points décroissants puis par seed initial', () => {
    const make = (id: string, points: number, seed: number): EnrichedTeam => ({
      id,
      name: id,
      initialSeed: seed,
      currentSeed: seed,
      status: 'ACTIVE',
      currentStageId: 's',
      currentStageStats: {
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        byes: 0,
        points,
        scoreFor: 0,
        scoreAgainst: 0,
        scoreDifference: 0,
        buchholzScore: 0,
        currentStreak: 0,
      },
      currentStageHistory: [],
      pastStages: [],
    });
    const sorted = StandingsCalculator.sortTeams([
      make('c', 3, 3),
      make('a', 6, 2),
      make('b', 3, 1),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('RoundRobinStageMacro (polygone de Berger)', () => {
  it('génère toutes les paires une seule fois sur la phase', () => {
    const stage = RoundRobinStageMacro.createStage('rr', 4);
    expect(stage.blocks).toHaveLength(3);
    expect(stage.connectors).toHaveLength(2);

    const graph = new TournamentGraph();
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
    graph.seedTeams(teams4, stage.blocks[0].id);
    graph.start();

    const pairs = new Set<string>();
    for (const block of stage.blocks) {
      playAllReady(graph, block.id);
      for (const match of graph.getAllMatches(block.id)) {
        const ids = [resolvedId(match.slotA), resolvedId(match.slotB)].filter(
          (id): id is string => id !== undefined,
        );
        expect(ids).toHaveLength(2);
        pairs.add(ids.slice().sort().join('|'));
      }
    }
    expect(pairs.size).toBe(6);
  });
});

describe('MergerBlock', () => {
  it('fusionne, retrie et réindexe les seeds', () => {
    const graph = new TournamentGraph();
    graph.addBlock(new SwissRoundBlock({ id: 's1', stageId: 's', roundNumber: 1 }));
    graph.addBlock(new SwissRoundBlock({ id: 's2', stageId: 's', roundNumber: 2 }));
    graph.addBlock(new MergerBlock({ id: 'merge' }));
    graph.connect('s1', 's2', {
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
      targetStageId: 's',
    });
    graph.connect('s2', 'merge', {
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
      targetStageId: 's',
    });

    graph.seedTeams(teams8, 's1');
    graph.start();
    playAllReady(graph, 's1');
    playAllReady(graph, 's2');

    const merger = graph.getBlock('merge');
    expect(merger.getState()).toBe('COMPLETED');
    expect(merger.getOutputTeamIds()).toHaveLength(8);
    const standings = graph.getStandings('merge');
    expect(standings.map((t) => t.currentSeed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('Sérialisation', () => {
  it('round-trip toJSON/fromJSON et poursuite du tournoi', () => {
    const graph = new TournamentGraph({ prngSeed: 99 });
    graph.addBlock(new SwissRoundBlock({ id: 'r1', stageId: 'swiss', roundNumber: 1 }));
    graph.addBlock(new SwissRoundBlock({ id: 'r2', stageId: 'swiss', roundNumber: 2 }));
    graph.connect('r1', 'r2', {
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
      targetStageId: 'swiss',
    });
    graph.seedTeams(teams4, 'r1');
    graph.start();
    playAllReady(graph, 'r1');

    const json = graph.toJSON();
    expect(json.version).toBe('3.0.0');
    expect(json.timeline.length).toBeGreaterThan(0);

    const restored = TournamentGraph.fromJSON(json);
    expect(restored.getStateHash()).toBe(graph.getStateHash());
    expect(restored.getPlayableMatches('r2')).toHaveLength(2);
    expect(restored.timeMachine.getTimeline()).toHaveLength(json.timeline.length);

    playAllReady(restored, 'r2');
    expect(restored.getPlayableMatches('r2')).toHaveLength(0);
    expect(restored.registry.getTeam('team-1')).toBeDefined();
  });

  it('conserve le déterminisme du stateHash après restauration', () => {
    const graph = new TournamentGraph({ prngSeed: 5, pointsConfig: { win: 2 } });
    graph.addBlock(new BracketRoundBlock({ id: 'b', stageId: 'x', roundNumber: 1 }));
    graph.seedTeams(teams4, 'b');
    graph.start();
    const before = graph.getStateHash();
    const clone = TournamentGraph.fromJSON(graph.toJSON());
    expect(clone.getStateHash()).toBe(before);
  });
});

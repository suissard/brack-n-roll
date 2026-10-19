import { describe, expect, it } from 'vitest';
import { BracketRoundBlock, SwissRoundBlock, TournamentGraph } from '../src/index';
import { loadTeams, matchTeamIds, playAllReady, resolvedId } from './helpers';

const teams4 = loadTeams('teams-4');
const teams8 = loadTeams('teams-8');

// ---------------------------------------------------------------------------
// Scénario 1
// ---------------------------------------------------------------------------

describe('Scenario 1 - Tournoi hybride complet (Suisse -> Top Cut)', () => {
  function build(): TournamentGraph {
    const graph = new TournamentGraph({ prngSeed: 7 });
    const stageId = 'swiss';

    graph.addBlock(new SwissRoundBlock({ id: 'swiss-1', stageId, roundNumber: 1 }));
    graph.addBlock(new SwissRoundBlock({ id: 'swiss-2', stageId, roundNumber: 2 }));
    graph.addBlock(new SwissRoundBlock({ id: 'swiss-3', stageId, roundNumber: 3 }));
    graph.addBlock(new BracketRoundBlock({ id: 'semis', stageId: 'playoffs', roundNumber: 1 }));
    graph.addBlock(new BracketRoundBlock({ id: 'final', stageId: 'playoffs', roundNumber: 2 }));

    graph.connect('swiss-1', 'swiss-2', {
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
      targetStageId: stageId,
    });
    graph.connect('swiss-2', 'swiss-3', {
      transferMode: 'BATCH',
      filterRule: { type: 'ALL' },
      statsResetPolicy: 'KEEP_ALL',
      targetStageId: stageId,
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

    return graph;
  }

  it('archive la phase suisse, remet les points à zéro et désigne un champion', () => {
    const graph = build();
    const stageId = 'swiss';
    graph.seedTeams(teams8, 'swiss-1');
    graph.start();

    for (let round = 1; round <= 3; round++) {
      const blockId = `swiss-${round}`;
      const matches = graph.getPlayableMatches(blockId);
      expect(matches).toHaveLength(4);
      for (const match of matches) {
        const a = resolvedId(match.slotA)!;
        const b = resolvedId(match.slotB)!;
        const aWins = Number(a.split('-')[1]) < Number(b.split('-')[1]);
        graph.reportMatchResult(match.id, aWins ? { scoreA: 3, scoreB: 1 } : { scoreA: 1, scoreB: 3 });
      }
    }

    expect(graph.getAllMatches('semis')).toHaveLength(2);
    expect(graph.getPlayableMatches('semis')).toHaveLength(2);

    const qualified = graph
      .getStandings('semis')
      .filter((team) => team.currentStageId === 'playoffs');
    expect(qualified).toHaveLength(4);

    for (const team of qualified) {
      expect(team.pastStages.some((stage) => stage.stageId === stageId)).toBe(true);
      expect(team.currentStageStats.points).toBe(0);
      expect(team.currentStageStats.played).toBe(0);
    }

    expect(graph.getStandings().filter((t) => t.status === 'ELIMINATED')).toHaveLength(4);

    playAllReady(graph, 'semis');
    expect(graph.getPlayableMatches('final')).toHaveLength(1);

    playAllReady(graph, 'final');
    const champions = graph.getStandings().filter((t) => t.status === 'CHAMPION');
    expect(champions).toHaveLength(1);

    const finalMatch = graph.getAllMatches('final')[0];
    expect(champions[0].id).toBe(finalMatch.winnerId);
  });
});

// ---------------------------------------------------------------------------
// Scénario 2
// ---------------------------------------------------------------------------

describe('Scenario 2 - Double élimination STREAMING & Bracket Reset', () => {
  function build(): TournamentGraph {
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
        skipCondition: {
          type: 'SKIP_IF_CONNECTOR_TEAM_UNDEFEATED',
          connectorId: 'upper-final-conn',
        },
      }),
    );

    const streaming = { transferMode: 'STREAMING' as const, statsResetPolicy: 'KEEP_ALL' as const, targetStageId: 'de' };
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

    return graph;
  }

  it('rend le Round 2 READY dès que les deux parents du Round 1 sont terminés', () => {
    const graph = build();
    graph.seedTeams(teams4, 'wb-r1');
    graph.start();

    expect(graph.getAllMatches('wb-final')[0].state).toBe('WAITING_FOR_SLOTS');
    expect(graph.getAllMatches('lb-r1')[0].state).toBe('WAITING_FOR_SLOTS');

    const wbR1 = graph.getPlayableMatches('wb-r1');
    expect(wbR1).toHaveLength(2);

    graph.reportMatchResult(wbR1[0].id, { scoreA: 3, scoreB: 0 });
    expect(graph.getAllMatches('wb-final')[0].state).toBe('WAITING_FOR_SLOTS');

    graph.reportMatchResult(wbR1[1].id, { scoreA: 3, scoreB: 0 });
    expect(graph.getAllMatches('wb-final')[0].state).toBe('READY');
    expect(graph.getAllMatches('lb-r1')[0].state).toBe('READY');
  });

  it('Cas A : le joueur du Winner Bracket gagne la GF1, le reset est court-circuité', () => {
    const graph = build();
    graph.seedTeams(teams4, 'wb-r1');
    graph.start();

    playAllReady(graph, 'wb-r1');
    playAllReady(graph, 'wb-final');
    playAllReady(graph, 'lb-r1');
    playAllReady(graph, 'lb-final');

    const gf1 = graph.getPlayableMatches('gf-1');
    expect(gf1).toHaveLength(1);
    const wbPlayer = resolvedId(gf1[0].slotA);

    // Le joueur du Winner Bracket gagne la Grande Finale 1.
    graph.reportMatchResult(gf1[0].id, { scoreA: 3, scoreB: 1 });

    const reset = graph.getBlock('bracket-reset');
    expect(reset.getState()).toBe('COMPLETED');
    expect(graph.getAllMatches('bracket-reset')).toHaveLength(0);

    const champions = graph.getStandings().filter((t) => t.status === 'CHAMPION');
    expect(champions).toHaveLength(1);
    expect(champions[0].id).toBe(wbPlayer);
  });

  it('Cas B : le joueur du Loser Bracket gagne la GF1, le reset génère le match décisif', () => {
    const graph = build();
    graph.seedTeams(teams4, 'wb-r1');
    graph.start();

    playAllReady(graph, 'wb-r1');
    playAllReady(graph, 'wb-final');
    playAllReady(graph, 'lb-r1');
    playAllReady(graph, 'lb-final');

    const gf1 = graph.getPlayableMatches('gf-1');
    expect(gf1).toHaveLength(1);
    const lbPlayer = resolvedId(gf1[0].slotB);

    graph.reportMatchResult(gf1[0].id, { scoreA: 1, scoreB: 3 });

    const resetMatches = graph.getPlayableMatches('bracket-reset');
    expect(resetMatches).toHaveLength(1);
    expect(matchTeamIds(resetMatches[0])).toContain(lbPlayer);

    graph.reportMatchResult(resetMatches[0].id, { scoreA: 2, scoreB: 0 });
    expect(graph.getStandings().filter((t) => t.status === 'CHAMPION')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scénario 3
// ---------------------------------------------------------------------------

describe('Scenario 3 - Time Machine & Causal Replay sur un arbre', () => {
  function build(): TournamentGraph {
    const graph = new TournamentGraph({ prngSeed: 3 });
    graph.addBlock(new BracketRoundBlock({ id: 'qf', stageId: 'tree', roundNumber: 1 }));
    graph.addBlock(new BracketRoundBlock({ id: 'sf', stageId: 'tree', roundNumber: 2 }));
    graph.addBlock(new BracketRoundBlock({ id: 'final', stageId: 'tree', roundNumber: 3 }));

    const streaming = {
      transferMode: 'STREAMING' as const,
      filterRule: { type: 'WINNERS' as const },
      statsResetPolicy: 'KEEP_ALL' as const,
      targetStageId: 'tree',
    };
    graph.connect('qf', 'sf', { id: 'qf-sf-conn', ...streaming });
    graph.connect('sf', 'final', { id: 'sf-final-conn', ...streaming });
    return graph;
  }

  it("orpheline seulement la demi-finale impactée et rejoue l'autre", () => {
    const graph = build();
    graph.seedTeams(teams8, 'qf');
    graph.start();

    const qfMatches = graph.getPlayableMatches('qf');
    expect(qfMatches).toHaveLength(4);
    for (const match of qfMatches) {
      graph.reportMatchResult(match.id, { scoreA: 2, scoreB: 0 });
    }

    const sfMatches = graph.getPlayableMatches('sf');
    expect(sfMatches).toHaveLength(2);
    for (const match of sfMatches) {
      graph.reportMatchResult(match.id, { scoreA: 2, scoreB: 0 });
    }

    // Le match de quart de finale amendé (M1) et son ancien vainqueur.
    const amendedQfMatch = graph.getAllMatches('qf')[1];
    const oldWinner = amendedQfMatch.winnerId as string;
    const impactedSf = graph
      .getAllMatches('sf')
      .find((match) => matchTeamIds(match).includes(oldWinner));
    const preservedSf = graph
      .getAllMatches('sf')
      .find((match) => !matchTeamIds(match).includes(oldWinner));
    expect(impactedSf).toBeDefined();
    expect(preservedSf).toBeDefined();

    const event = graph.timeMachine
      .getTimeline()
      .find(
        (candidate) =>
          candidate.payload.type === 'MATCH_RESULT_REPORTED' &&
          candidate.payload.matchId === amendedQfMatch.id,
      );
    expect(event).toBeDefined();
    if (!event || event.payload.type !== 'MATCH_RESULT_REPORTED') throw new Error('event manquant');

    const [a, b] = event.payload.expectedTeams;
    const newPayload = {
      type: 'MATCH_RESULT_REPORTED' as const,
      blockId: event.payload.blockId,
      matchId: event.payload.matchId,
      expectedTeams: [a, b] as [string, string],
      scores: { [a]: 0, [b]: 1 },
    };

    const result = graph.amendEvent(event.eventId, newPayload);

    expect(result.orphanedEvents).toHaveLength(1);
    expect(result.orphanedEvents[0].event.payload.type).toBe('MATCH_RESULT_REPORTED');
    const orphanPayload = result.orphanedEvents[0].event.payload;
    if (orphanPayload.type !== 'MATCH_RESULT_REPORTED') throw new Error('payload inattendu');
    expect(orphanPayload.blockId).toBe('sf');
    expect(orphanPayload.expectedTeams).toContain(oldWinner);

    expect(result.appliedEvents).toHaveLength(3);
    const appliedSf = result.appliedEvents.filter(
      (applied) => applied.payload.type === 'MATCH_RESULT_REPORTED' && applied.payload.blockId === 'sf',
    );
    expect(appliedSf).toHaveLength(1);
    expect(appliedSf[0].payload).toMatchObject({
      expectedTeams: matchTeamIds(preservedSf!),
    });

    // Le nouveau vainqueur a bien pris la place de l'ancien dans la demi-finale impactée.
    const impactedAfter = graph.getAllMatches('sf').find((match) => match.matchIndex === impactedSf!.matchIndex);
    expect(impactedAfter).toBeDefined();
    expect(matchTeamIds(impactedAfter!)).toContain(b);
    expect(matchTeamIds(impactedAfter!)).not.toContain(oldWinner);
    expect(result.newHeadStateHash).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Scénario 4
// ---------------------------------------------------------------------------

describe('Scenario 4 - Clé sémantique nominative & inversion de table', () => {
  it("retrouve un match par couple d'équipes quand le matchId est obsolète", () => {
    const graph = new TournamentGraph();
    graph.addBlock(new BracketRoundBlock({ id: 'b', stageId: 's', roundNumber: 1 }));
    graph.seedTeams(teams4, 'b');
    graph.start();

    const match = graph.getPlayableMatches('b')[0];
    const [a, b] = [
      resolvedId(match.slotA)!,
      resolvedId(match.slotB)!,
    ];
    const block = graph.getBlock('b');

    const byTeams = block.findMatchForResult('table-inexistante', [a, b]);
    expect(byTeams?.match.id).toBe(match.id);
    expect(byTeams?.swapped).toBe(false);

    const reversed = block.findMatchForResult('table-inexistante', [b, a]);
    expect(reversed?.match.id).toBe(match.id);
    expect(reversed?.swapped).toBe(true);

    expect(block.findMatchForResult('table-inexistante', ['inconnu-1', 'inconnu-2'])).toBeNull();
  });

  it('retrouve le duel par expectedTeams et réapplique les scores par teamId', () => {
    const graph = new TournamentGraph({ prngSeed: 5 });
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

    const r1 = graph.getPlayableMatches('r1');
    expect(r1).toHaveLength(2);
    const [a, b] = matchTeamIds(r1[0]);
    const [c, d] = matchTeamIds(r1[1]);

    // A bat B largement, C bat D plus modestement.
    graph.reportMatchResult(r1[0].id, { scoreA: 5, scoreB: 0 });
    graph.reportMatchResult(r1[1].id, { scoreA: 3, scoreB: 0 });

    const r2 = graph.getPlayableMatches('r2');
    expect(r2).toHaveLength(2);
    // Table 1 : A vs C ; Table 2 : D vs B.
    const table1 = r2.find((m) => matchTeamIds(m).join(',') === [a, c].join(',')) ?? r2[0];
    expect(matchTeamIds(table1)).toEqual([a, c]);
    graph.reportMatchResult(table1.id, { scoreA: 10, scoreB: 5 });
    const table2 = r2.find((m) => m.id !== table1.id)!;
    graph.reportMatchResult(table2.id, { scoreA: 7, scoreB: 2 });

    const event = graph.timeMachine
      .getTimeline()
      .find(
        (candidate) =>
          candidate.payload.type === 'MATCH_RESULT_REPORTED' &&
          candidate.payload.matchId === r1[0].id,
      );
    expect(event).toBeDefined();
    if (!event || event.payload.type !== 'MATCH_RESULT_REPORTED') throw new Error('event manquant');

    const [ea, eb] = event.payload.expectedTeams;
    const amended = graph.amendEvent(event.eventId, {
      type: 'MATCH_RESULT_REPORTED',
      blockId: event.payload.blockId,
      matchId: event.payload.matchId,
      expectedTeams: [ea, eb],
      scores: { [ea]: 1, [eb]: 0 },
    });

    expect(amended.orphanedEvents).toHaveLength(0);
    expect(amended.appliedEvents).toHaveLength(3);

    const newR2 = graph.getPlayableMatches('r2');
    expect(newR2).toHaveLength(0); // les deux tables ont été rejouées automatiquement
    const replayedTable = graph
      .getAllMatches('r2')
      .find((m) => matchTeamIds(m).sort().join(',') === [a, c].sort().join(','));
    expect(replayedTable).toBeDefined();
    // Inversion Domicile/Extérieur : C est désormais en slotA, A en slotB.
    expect(resolvedId(replayedTable!.slotA)).toBe(c);
    expect(resolvedId(replayedTable!.slotB)).toBe(a);
    // Scores nominatifs correctement réappliqués.
    expect(replayedTable!.scoreA).toBe(5);
    expect(replayedTable!.scoreB).toBe(10);
    expect(replayedTable!.winnerId).toBe(a);
    expect(graph.registry.getTeam(a).currentStageStats.points).toBeGreaterThan(0);

    // L'ancien duel D-B reste lui aussi rejoué (avec inversion).
    const otherTable = graph
      .getAllMatches('r2')
      .find((m) => matchTeamIds(m).sort().join(',') === [b, d].sort().join(','));
    expect(otherTable).toBeDefined();
    expect(otherTable!.scoreA).toBe(2);
    expect(otherTable!.scoreB).toBe(7);
    expect(otherTable!.winnerId).toBe(d);
  });
});

// ---------------------------------------------------------------------------
// Scénario 5
// ---------------------------------------------------------------------------

describe('Scenario 5 - Abandon (TEAM_DROPPED) & pertinence du Buchholz', () => {
  it('forfaitise le match, exclut l’équipe des appariements et conserve le Buchholz', () => {
    const graph = new TournamentGraph({ prngSeed: 13 });
    graph.addBlock(new SwissRoundBlock({ id: 'r1', stageId: 'swiss', roundNumber: 1 }));
    graph.addBlock(new SwissRoundBlock({ id: 'r2', stageId: 'swiss', roundNumber: 2 }));
    graph.addBlock(new SwissRoundBlock({ id: 'r3', stageId: 'swiss', roundNumber: 3 }));
    for (const [source, target] of [
      ['r1', 'r2'],
      ['r2', 'r3'],
    ]) {
      graph.connect(source, target, {
        transferMode: 'BATCH',
        filterRule: { type: 'ALL' },
        statsResetPolicy: 'KEEP_ALL',
        targetStageId: 'swiss',
      });
    }

    graph.seedTeams(teams8, 'r1');
    graph.start();

    const r1 = graph.getPlayableMatches('r1');
    for (const match of r1) {
      graph.reportMatchResult(match.id, { scoreA: 3, scoreB: 1 });
    }

    // T gagne au Round 1 contre O.
    const firstMatch = graph.getAllMatches('r1')[0];
    const droppedTeam = firstMatch.winnerId as string;
    const roundOneOpponent = matchTeamIds(firstMatch).find((id) => id !== droppedTeam)!;

    const r2BeforeDrop = graph.getAllMatches('r2');
    const droppedMatchBefore = r2BeforeDrop.find((m) => matchTeamIds(m).includes(droppedTeam));
    expect(droppedMatchBefore).toBeDefined();

    graph.dropTeam(droppedTeam, 'blessure');

    const droppedMatch = graph.getAllMatches('r2').find((m) => m.id === droppedMatchBefore!.id)!;
    expect(droppedMatch.state).toBe('COMPLETED');
    expect(droppedMatch.winnerId).not.toBe(droppedTeam);
    expect(matchTeamIds(droppedMatch)).toContain(droppedMatch.winnerId as string);
    expect(graph.registry.getTeam(droppedTeam).status).toBe('DROPPED');

    // Les autres matchs du Round 2 sont joués normalement.
    playAllReady(graph, 'r2');

    const r3 = graph.getAllMatches('r3');
    expect(r3.length).toBeGreaterThan(0);
    for (const match of r3) {
      expect(matchTeamIds(match)).not.toContain(droppedTeam);
    }

    // L'adversaire du Round 1 conserve le point de Buchholz apporté par T.
    const opponent = graph.registry.getTeam(roundOneOpponent);
    expect(opponent.currentStageStats.buchholzScore).toBeGreaterThanOrEqual(3);
    expect(graph.registry.getTeam(droppedTeam).currentStageStats.points).toBe(3);
  });
});

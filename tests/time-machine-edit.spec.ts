import { describe, expect, it } from 'vitest';
import { BracketRoundBlock, SwissRoundBlock, TournamentGraph } from '../src/index';
import { loadTeams, matchTeamIds, playAllReady } from './helpers';

const teams4 = loadTeams('teams-4');
const teams8 = loadTeams('teams-8');

function buildBracket(): TournamentGraph {
  const graph = new TournamentGraph({ prngSeed: 3 });
  graph.addBlock(new BracketRoundBlock({ id: 'b', stageId: 'tree', roundNumber: 1 }));
  return graph;
}

function buildStreamingTree(): TournamentGraph {
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

describe('Renommage des équipes (TEAM_RENAMED)', () => {
  it('applique, persiste et peut être supprimé par la Time Machine', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    graph.start();

    graph.renameTeam('team-1', 'Alpha Prime');
    expect(graph.registry.getTeam('team-1').name).toBe('Alpha Prime');

    const restored = TournamentGraph.fromJSON(graph.toJSON());
    expect(restored.registry.getTeam('team-1').name).toBe('Alpha Prime');

    const renameEvent = restored.timeMachine
      .getTimeline()
      .find((event) => event.payload.type === 'TEAM_RENAMED');
    expect(renameEvent).toBeDefined();
    if (!renameEvent) throw new Error('event manquant');

    const result = restored.deleteEvent(renameEvent.eventId);
    expect(result.removedEvent.payload.type).toBe('TEAM_RENAMED');
    expect(restored.registry.getTeam('team-1').name).toBe('Alpha');
    expect(restored.getPlayableMatches('b')).toHaveLength(2);
  });

  it('rejette un nom vide', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    expect(() => graph.renameTeam('team-1', '   ')).toThrow();
  });
});

describe('Suppression d’une ligne de timeline (deleteEvent)', () => {
  it('rejoue les résultats suivants et orpheline ceux devenus incompatibles', () => {
    const graph = buildStreamingTree();
    graph.seedTeams(teams8, 'qf');
    graph.start();
    playAllReady(graph, 'qf');
    playAllReady(graph, 'sf');

    const qfZero = graph.getAllMatches('qf')[0];
    const event = graph.timeMachine
      .getTimeline()
      .find(
        (candidate) =>
          candidate.payload.type === 'MATCH_RESULT_REPORTED' &&
          candidate.payload.matchId === qfZero.id,
      );
    expect(event).toBeDefined();
    if (!event) throw new Error('event manquant');

    const lengthBefore = graph.timeMachine.getLength();
    const result = graph.deleteEvent(event.eventId);

    expect(result.removedEvent.eventId).toBe(event.eventId);
    expect(result.orphanedEvents).toHaveLength(1);
    const orphan = result.orphanedEvents[0].event.payload;
    if (orphan.type !== 'MATCH_RESULT_REPORTED') throw new Error('orphelin inattendu');
    expect(orphan.blockId).toBe('sf');
    expect(result.appliedEvents.length).toBeGreaterThan(0);

    // Le match supprimé redevient jouable ; la demi-finale impactée attend ses slots.
    expect(graph.getAllMatches('qf').find((m) => m.id === qfZero.id)?.state).toBe('READY');
    expect(graph.getPlayableMatches('qf')).toHaveLength(1);
    expect(graph.getPlayableMatches('sf')).toHaveLength(0);
    expect(graph.timeMachine.getLength()).toBe(lengthBefore - 2);
  });

  it('interdit la suppression de TOURNAMENT_INITIALIZED', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    const init = graph.timeMachine.getTimeline()[0];
    expect(() => graph.deleteEvent(init.eventId)).toThrow(/TOURNAMENT_INITIALIZED/);
  });

  it('supprimer TOURNAMENT_STARTED remet le tournoi à l’état « prêt à démarrer »', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    graph.start();
    const first = graph.getPlayableMatches('b')[0];
    graph.reportMatchResult(first.id, { scoreA: 2, scoreB: 0 });

    const startEvent = graph.timeMachine
      .getTimeline()
      .find((event) => event.payload.type === 'TOURNAMENT_STARTED');
    expect(startEvent).toBeDefined();
    if (!startEvent) throw new Error('event manquant');

    const result = graph.deleteEvent(startEvent.eventId);
    expect(result.orphanedEvents).toHaveLength(1);
    expect(graph.getPlayableMatches('b')).toHaveLength(0);

    // Le tournoi peut être redémarré proprement.
    graph.start();
    expect(graph.getPlayableMatches('b')).toHaveLength(2);
  });
});

describe('Retour en arrière (rewindTo)', () => {
  it('tronque la timeline et restaure l’état exact de l’événement ciblé', () => {
    const graph = buildStreamingTree();
    graph.seedTeams(teams8, 'qf');
    graph.start();
    playAllReady(graph, 'qf');
    playAllReady(graph, 'sf');

    const sfResults = graph.timeMachine
      .getTimeline()
      .filter(
        (event) =>
          event.payload.type === 'MATCH_RESULT_REPORTED' && event.payload.blockId === 'sf',
      );
    expect(sfResults).toHaveLength(2);

    const target = sfResults[0];
    const lengthBefore = graph.timeMachine.getLength();
    const result = graph.rewindTo(target.eventId);

    expect(result.removedEvents).toHaveLength(lengthBefore - (target.sequenceIndex + 1));
    expect(graph.timeMachine.getLength()).toBe(target.sequenceIndex + 1);
    expect(graph.getPlayableMatches('sf')).toHaveLength(1);
    expect(graph.getPlayableMatches('qf')).toHaveLength(0);
  });

  it('peut revenir jusqu’à TOURNAMENT_INITIALIZED', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    graph.start();

    const init = graph.timeMachine.getTimeline()[0];
    const result = graph.rewindTo(init.eventId);

    expect(result.removedEvents.length).toBeGreaterThan(0);
    expect(graph.timeMachine.getLength()).toBe(1);
    expect(graph.registry.getAllTeams()).toHaveLength(0);
    expect(graph.getPlayableMatches('b')).toHaveLength(0);
  });
});

describe('reseedTeams sur un tournoi suisse déjà lancé', () => {
  function buildSwiss(): TournamentGraph {
    const graph = new TournamentGraph({ prngSeed: 7 });
    graph.addBlock(new SwissRoundBlock({ id: 'swiss-1', stageId: 'swiss', roundNumber: 1 }));
    graph.addBlock(new SwissRoundBlock({ id: 'swiss-2', stageId: 'swiss', roundNumber: 2 }));
    graph.addBlock(new SwissRoundBlock({ id: 'swiss-3', stageId: 'swiss', roundNumber: 3 }));
    for (const [source, target] of [
      ['swiss-1', 'swiss-2'],
      ['swiss-2', 'swiss-3'],
    ]) {
      graph.connect(source, target, {
        transferMode: 'BATCH',
        filterRule: { type: 'ALL' },
        statsResetPolicy: 'KEEP_ALL',
        targetStageId: 'swiss',
      });
    }
    return graph;
  }

  it('conserve le hash d’état quand l’ordre est inchangé', () => {
    const graph = buildSwiss();
    graph.seedTeams(teams8, 'swiss-1');
    graph.start();
    playAllReady(graph, 'swiss-1');
    playAllReady(graph, 'swiss-2');

    const order = graph.registry
      .getAllTeams()
      .slice()
      .sort((a, b) => a.initialSeed - b.initialSeed)
      .map((team) => team.id);
    const hashBefore = graph.getStateHash();

    const result = graph.reseedTeams('swiss-1', order);

    expect(result.orphanedEvents).toHaveLength(0);
    expect(result.appliedEvents.length).toBeGreaterThan(0);
    expect(graph.getStateHash()).toBe(hashBefore);
  });

  it('orpheline les rondes dont les appariements ont changé', () => {
    const graph = buildSwiss();
    graph.seedTeams(teams8, 'swiss-1');
    graph.start();
    playAllReady(graph, 'swiss-1');
    playAllReady(graph, 'swiss-2');

    // Échange les voisins deux à deux : les appariements suisses ne sont plus
    // les mêmes, donc les résultats des rondes déjà jouées sont orphelinés.
    const shuffled = [
      'team-1',
      'team-3',
      'team-2',
      'team-4',
      'team-5',
      'team-7',
      'team-6',
      'team-8',
    ];
    const result = graph.reseedTeams('swiss-1', shuffled);

    expect(result.orphanedEvents.length).toBeGreaterThan(0);
    // Le tournoi reste démarré et la première ronde est de nouveau jouable.
    expect(graph.getPlayableMatches('swiss-1')).toHaveLength(4);
    expect(
      graph.timeMachine.getTimeline().some((event) => event.payload.type === 'TOURNAMENT_STARTED'),
    ).toBe(true);
  });
});

describe('Gestion du seeding (reseedTeams)', () => {
  it('réécrit TEAMS_SEEDED, réindexe les seeds et régénère les appariements', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    graph.start();
    expect(matchTeamIds(graph.getAllMatches('b')[0])).toEqual(['team-1', 'team-4']);

    const result = graph.reseedTeams('b', ['team-4', 'team-3', 'team-2', 'team-1']);

    expect(result.orphanedEvents).toHaveLength(0);
    expect(graph.registry.getTeam('team-4').initialSeed).toBe(1);
    expect(graph.registry.getTeam('team-1').initialSeed).toBe(4);
    expect(matchTeamIds(graph.getAllMatches('b')[0])).toEqual(['team-4', 'team-1']);
    expect(graph.getPlayableMatches('b')).toHaveLength(2);
    // Le TOURNAMENT_STARTED a bien été rejoué (le bloc reste en cours).
    expect(graph.getAllMatches('b').length).toBeGreaterThan(0);
  });

  it('orpheline les résultats dont l’appariement disparaît', () => {
    const graph = buildBracket();
    graph.seedTeams(teams4, 'b');
    graph.start();
    const first = graph.getPlayableMatches('b')[0];
    graph.reportMatchResult(first.id, { scoreA: 2, scoreB: 0 });

    const result = graph.reseedTeams('b', ['team-1', 'team-3', 'team-4', 'team-2']);

    expect(result.orphanedEvents.length).toBeGreaterThanOrEqual(1);
    expect(matchTeamIds(graph.getAllMatches('b')[0])).toEqual(['team-1', 'team-2']);
  });
});

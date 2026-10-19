import type {
  EnrichedTeam,
  MatchHistoryEntry,
  PointsConfig,
  StatsResetPolicy,
  TeamBase,
  TeamStats,
} from '../types/domain.types';

export function emptyStats(): TeamStats {
  return {
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    byes: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    scoreDifference: 0,
    buchholzScore: 0,
    currentStreak: 0,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Dictionnaire central de l'état enrichi de toutes les équipes.
 *
 * Il conserve l'historique par phase, l'archive des phases passées et calcule
 * les scores Buchholz (somme des points des adversaires rencontrés dans une
 * même phase).
 */
export class TournamentRegistry {
  private teams: Map<string, EnrichedTeam> = new Map();

  registerTeams(baseTeams: TeamBase[], stageId: string): void {
    for (const base of baseTeams) {
      const existing = this.teams.get(base.id);
      if (existing) continue;
      const enriched: EnrichedTeam = {
        id: base.id,
        name: base.name,
        initialSeed: base.initialSeed,
        ...(base.customMeta !== undefined ? { customMeta: clone(base.customMeta) } : {}),
        currentSeed: base.initialSeed,
        status: 'ACTIVE',
        currentStageId: stageId,
        currentStageStats: emptyStats(),
        currentStageHistory: [],
        pastStages: [],
      };
      this.teams.set(base.id, enriched);
    }
  }

  hasTeam(teamId: string): boolean {
    return this.teams.has(teamId);
  }

  getTeam(teamId: string): EnrichedTeam {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`TournamentRegistry: équipe introuvable "${teamId}"`);
    return team;
  }

  getAllTeams(): EnrichedTeam[] {
    return [...this.teams.values()];
  }

  updateTeam(team: EnrichedTeam): void {
    this.teams.set(team.id, team);
  }

  /**
   * Enregistre l'issue d'un match pour une équipe et met à jour ses statistiques.
   * Un `BYE` incrémente `byes` et `wins` et ajoute `pointsConfig.bye` aux points.
   */
  recordMatchOutcome(teamId: string, entry: MatchHistoryEntry, pointsConfig: PointsConfig): void {
    const team = this.getTeam(teamId);
    const stats = team.currentStageStats;
    team.currentStageHistory.push(entry);

    switch (entry.result) {
      case 'WIN':
        stats.played += 1;
        stats.wins += 1;
        stats.points += pointsConfig.win;
        stats.scoreFor += entry.scoreFor;
        stats.scoreAgainst += entry.scoreAgainst;
        stats.currentStreak = stats.currentStreak > 0 ? stats.currentStreak + 1 : 1;
        break;
      case 'LOSS':
        stats.played += 1;
        stats.losses += 1;
        stats.points += pointsConfig.loss;
        stats.scoreFor += entry.scoreFor;
        stats.scoreAgainst += entry.scoreAgainst;
        stats.currentStreak = stats.currentStreak < 0 ? stats.currentStreak - 1 : -1;
        break;
      case 'DRAW':
        stats.played += 1;
        stats.draws += 1;
        stats.points += pointsConfig.draw;
        stats.scoreFor += entry.scoreFor;
        stats.scoreAgainst += entry.scoreAgainst;
        stats.currentStreak = 0;
        break;
      case 'BYE':
        stats.byes += 1;
        stats.wins += 1;
        stats.points += pointsConfig.bye;
        stats.currentStreak = stats.currentStreak > 0 ? stats.currentStreak + 1 : 1;
        break;
    }
    stats.scoreDifference = stats.scoreFor - stats.scoreAgainst;
  }

  /**
   * Recalcule le Buchholz de chaque équipe : somme des points des adversaires
   * rencontrés dans la phase courante (l'adversaire est retrouvé même s'il est
   * `DROPPED`/`ELIMINATED`, ou via ses archives s'il a changé de phase).
   */
  recomputeAllBuchholzScores(): void {
    for (const team of this.teams.values()) {
      let total = 0;
      for (const entry of team.currentStageHistory) {
        if (entry.opponentId === 'BYE') continue;
        const opponent = this.teams.get(entry.opponentId);
        if (!opponent) continue;
        if (opponent.currentStageId === team.currentStageId) {
          total += opponent.currentStageStats.points;
        } else {
          const archive = opponent.pastStages.find((s) => s.stageId === team.currentStageId);
          if (archive) total += archive.stats.points;
        }
      }
      team.currentStageStats.buchholzScore = total;
    }
  }

  applyStatsReset(teamId: string, policy: StatsResetPolicy, newStageId: string): void {
    const team = this.getTeam(teamId);
    if (policy === 'KEEP_ALL') {
      team.currentStageId = newStageId;
      return;
    }

    team.pastStages.push({
      stageId: team.currentStageId,
      sourceBlockId: '',
      finalSeedInStage: team.currentSeed,
      stats: clone(team.currentStageStats),
      history: clone(team.currentStageHistory),
    });
    team.currentStageStats = emptyStats();
    if (policy === 'ARCHIVE_AND_RESET_ALL') {
      team.currentStageHistory = [];
    }
    // RESET_POINTS_KEEP_HISTORY : on conserve l'historique pour interdire les rematches.
    team.currentStageId = newStageId;
  }

  serialize(): Array<[string, EnrichedTeam]> {
    return [...this.teams.entries()].map(([id, team]) => [id, clone(team)]);
  }

  restore(data: Array<[string, EnrichedTeam]>): void {
    this.teams = new Map(data.map(([id, team]) => [id, clone(team)]));
  }

  clear(): void {
    this.teams.clear();
  }
}

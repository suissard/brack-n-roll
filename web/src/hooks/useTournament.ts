import { useSyncExternalStore } from 'react';
import { tournamentStore, type TournamentView } from '../store/tournamentStore';

/** S'abonne à la vue du tournoi exposée par le store. */
export function useTournament(): TournamentView {
  return useSyncExternalStore(tournamentStore.subscribe, tournamentStore.getSnapshot, tournamentStore.getSnapshot);
}

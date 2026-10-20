import { useSyncExternalStore } from 'react';
import { formatStore, type FormatViewState } from '../store/formatStore';

/** S'abonne à l'état de l'éditeur de formats. */
export function useFormats(): FormatViewState {
  return useSyncExternalStore(formatStore.subscribe, formatStore.getSnapshot, formatStore.getSnapshot);
}

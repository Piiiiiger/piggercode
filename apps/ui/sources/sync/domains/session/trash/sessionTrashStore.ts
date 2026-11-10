import { create } from 'zustand';

import type { Session } from '@/sync/domains/state/storageTypes';

export type SessionTrashStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SessionTrashState = Readonly<{
    /** The active server's trashed sessions decrypted so far (the last known list until a read replaces it), or null before the first read. */
    sessions: ReadonlyArray<Session> | null;
    /** How many sessions the server reported in the trash (known as soon as the pages arrive, before their rows decrypt). */
    count: number | null;
    status: SessionTrashStatus;
    /** True once every page was read and every reported row is in `sessions`: only then is the list the whole trash. */
    complete: boolean;
    update: (patch: Partial<Pick<SessionTrashState, 'sessions' | 'count' | 'status' | 'complete'>>) => void;
    reset: () => void;
}>;

const INITIAL = { sessions: null, count: null, status: 'idle', complete: false } as const;

/**
 * The trash (回收站) is not part of the session store: a trashed session is in no other list. The sidebar
 * entry reads only the count; the trash screen reads the rest.
 */
export const useSessionTrashStore = create<SessionTrashState>((set) => ({
    ...INITIAL,
    update: (patch) => set(patch),
    reset: () => set(INITIAL),
}));

export function useSessionTrashCount(): number {
    return useSessionTrashStore((state) => state.count ?? 0);
}

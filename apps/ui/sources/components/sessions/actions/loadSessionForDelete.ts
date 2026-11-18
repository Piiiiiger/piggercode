import { readDirectSessionLink } from '@/sync/domains/session/directSessions/readDirectSessionLink';
import { storage } from '@/sync/domains/state/storage';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

/** The session Delete is about to act on, as a row or the session screen knows it. */
export type SessionDeleteLoadTarget = Readonly<{
    sessionId: string;
    serverId?: string | null;
    /** Linked to a provider session (direct storage): its copy on the machine moves with it. */
    linked?: boolean;
}>;

export type SessionDeleteLoadDeps = Readonly<{
    isLoaded: (sessionId: string) => boolean;
    /** Whether the loaded session carries a link its machine copy can be found by. */
    isLinkReadable: (sessionId: string) => boolean;
    load: (sessionId: string, serverId: string | null) => Promise<unknown>;
}>;

/** This device's session store, and the sync engine's load of one session from its server. */
const storeDeps: SessionDeleteLoadDeps = {
    isLoaded: (sessionId) => storage.getState().sessions[sessionId] !== undefined,
    isLinkReadable: (sessionId) => readDirectSessionLink(storage.getState().sessions[sessionId]?.metadata) !== null,
    load: (sessionId, serverId) => getSyncSingleton().ensureSessionVisibleForMessageRoute(sessionId, serverId ? { serverId } : undefined),
};

/**
 * Delete (of one session or of several) reads the loaded session: its machine stops it through it, and the trash
 * finds a linked session's machine copy through the link it carries. The list shows sessions from their light rows,
 * so one this device lacks is loaded first. A linked one whose link still cannot be read is refused with the reason,
 * since trashing it would leave its machine copy behind; any other goes ahead (its stop and the trash request still
 * decide).
 */
export async function loadSessionForDelete(target: SessionDeleteLoadTarget, deps: SessionDeleteLoadDeps = storeDeps): Promise<void> {
    if (!deps.isLoaded(target.sessionId)) await deps.load(target.sessionId, target.serverId ?? null);
    if (target.linked === true && !deps.isLinkReadable(target.sessionId)) {
        throw new HappyError(t('sessionInfo.deleteLinkedSessionNotLoaded'), false);
    }
}

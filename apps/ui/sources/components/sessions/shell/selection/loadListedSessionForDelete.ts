import type { SessionBulkActionTarget } from '@/components/sessions/actions/sessionBulkActionTypes';
import { t } from '@/text';

/**
 * The list shows sessions from their light rows, while Delete reads the loaded session: its machine stops it through
 * it, and a linked session's machine copy is found through the link it carries. Loads a session this device lacks
 * first. A linked one (as its own row says) whose link still cannot be read from the loaded session is refused, since
 * trashing it would leave its machine copy behind; any other goes ahead (its stop and the trash request still
 * decide), as the single Delete does.
 */
export async function loadListedSessionForDelete(
    target: Pick<SessionBulkActionTarget, 'sessionId' | 'serverId' | 'linked'>,
    deps: Readonly<{
        isLoaded: (sessionId: string) => boolean;
        /** Whether the loaded session carries a link its machine copy can be found by. */
        isLinkReadable: (sessionId: string) => boolean;
        load: (sessionId: string, serverId: string | null) => Promise<unknown>;
    }>,
): Promise<void> {
    if (!deps.isLoaded(target.sessionId)) await deps.load(target.sessionId, target.serverId ?? null);
    if (target.linked === true && !deps.isLinkReadable(target.sessionId)) {
        throw new Error(t('sessionsList.selectionDeleteNotLoaded'));
    }
}

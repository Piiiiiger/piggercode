import { resolvePersistedCodexRuntimeIdentity, resolvePersistedCodexVendorSessionId } from '@happier-dev/agents';

import type { Session } from '@/sync/domains/state/storageTypes';

/**
 * A running Codex App Server session whose runner publishes shared local control can open
 * Codex's own TUI against the same thread: `happier attach` starts an independent native client
 * on the shared app-server, so the session terminal shows the real Codex CLI. The CLI attach
 * eligibility stays authoritative; this only decides whether to offer the entry.
 */
export function isCodexSharedAttachedSessionTerminalAvailable(session: Session): boolean {
    const localControl = session.agentState?.localControl;
    return session.active === true
        && localControl?.topology === 'shared'
        && localControl.canAttach === true
        && resolvePersistedCodexRuntimeIdentity(session.metadata ?? null)?.backendMode === 'appServer'
        && resolvePersistedCodexVendorSessionId(session.metadata ?? null) !== null;
}

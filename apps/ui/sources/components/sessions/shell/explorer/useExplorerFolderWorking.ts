import React from 'react';

import { useSessionListRuntimeNowMs } from '@/hooks/session/sessionListRuntimeClock';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { storage } from '@/sync/domains/state/storage';
import { getSessionStatus } from '@/utils/sessions/sessionUtils';

import { deriveSessionListRowAttentionState } from '../row/buildSessionListRowModel';
import type { SessionListRowPresentationSettings } from '../row/sessionListRowModelTypes';

type Renderables = Readonly<Record<string, SessionListRenderableSession | undefined>>;
type BackgroundWorkAttentionMode = SessionListRowPresentationSettings['backgroundWorkAttentionMode'];

const NO_RENDERABLES: Renderables = Object.freeze({});
const NO_IDS: readonly string[] = [];

// Every folder row asks about the same sessions at the same moment: one look at each session per store
// change, clock tick or setting change serves them all.
let lastLook: Readonly<{
    renderables: Renderables;
    nowMs: number;
    mode: BackgroundWorkAttentionMode;
    working: ReadonlySet<string>;
}> | null = null;

function workingSessionIds(renderables: Renderables, nowMs: number, mode: BackgroundWorkAttentionMode): ReadonlySet<string> {
    if (lastLook && lastLook.renderables === renderables && lastLook.nowMs === nowMs && lastLook.mode === mode) {
        return lastLook.working;
    }
    const working = new Set<string>();
    for (const [id, session] of Object.entries(renderables)) {
        if (!session) continue;
        const attention = deriveSessionListRowAttentionState({
            session,
            sessionState: getSessionStatus(session, nowMs).state,
            backgroundWorkAttentionMode: mode,
        });
        // The state a session row shows with its working spinner.
        if (attention === 'thinking') working.add(id);
    }
    lastLook = { renderables, nowMs, mode, working };
    return working;
}

/**
 * Whether one of the sessions below an explorer folder (`sessionIds`, one per line) works, as its own list row
 * shows it (its working spinner, not a request waiting for the user), so a closed folder still shows it. The row
 * re-renders only when the answer changes; while the list is not in use it keeps the last answer.
 */
export function useExplorerFolderWorking(
    sessionIds: string | undefined,
    enabled: boolean,
    backgroundWorkAttentionMode: BackgroundWorkAttentionMode,
): boolean {
    const nowMs = useSessionListRuntimeNowMs(enabled);
    const ids = React.useMemo(() => (sessionIds ? sessionIds.split('\n') : NO_IDS), [sessionIds]);
    const lastRef = React.useRef(false);
    const select = React.useCallback((state: Readonly<{ sessionListRenderables?: Renderables }>): boolean => {
        if (!enabled) return lastRef.current;
        if (ids.length === 0) return false;
        const working = workingSessionIds(state.sessionListRenderables ?? NO_RENDERABLES, nowMs, backgroundWorkAttentionMode);
        return ids.some((id) => working.has(id));
    }, [backgroundWorkAttentionMode, enabled, ids, nowMs]);
    const working = storage(select);
    lastRef.current = working;
    return working;
}

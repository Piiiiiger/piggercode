import * as React from 'react';

import { nowServerMs } from '@/sync/runtime/time';
import { startRuntimeActiveGatedInterval } from '@/utils/runtime/isRuntimeActive';

const CLOCK_TICK_MS = 1000;

/** How long a turn has run, the way Claude Code prints it: `54s`, `2m 54s`, `1h 3m`. */
export function formatWorkingElapsed(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

/**
 * Server time, refreshed once a second while `startedAt` is set and the app is active, for a running
 * turn's elapsed time. Only the component that reads it re-renders as it ticks.
 */
export function useRunningTurnServerClock(startedAt: number | null): number {
    const [now, setNow] = React.useState(() => nowServerMs());
    React.useEffect(() => {
        if (startedAt === null) return;
        setNow(nowServerMs());
        return startRuntimeActiveGatedInterval(() => setNow(nowServerMs()), CLOCK_TICK_MS);
    }, [startedAt]);
    return now;
}

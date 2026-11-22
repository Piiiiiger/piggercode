import { useSessionViewShellSessionSeq } from '../sessionViewStableSession';
import { useSessionViewedLifecycle } from './useSessionViewedLifecycle';

/**
 * Marks the session viewed while its surface is open. Every session shows its CLI's own terminal, so what the person
 * is looking at is the session as of its newest seq.
 */
export function SessionSurfaceViewedLifecycle({
    sessionId,
    serverId,
    surfaceFocused,
}: Readonly<{
    sessionId: string;
    serverId: string | null;
    surfaceFocused: boolean;
}>) {
    const sessionSeq = useSessionViewShellSessionSeq(sessionId);
    useSessionViewedLifecycle({
        sessionId,
        serverId,
        surfaceFocused,
        visibleReadSeq: sessionSeq,
    });
    return null;
}

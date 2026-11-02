import type { ManagedConnectionSupervisor } from '@piggercode/connection-supervisor';

/**
 * Queue admission and ACK waiters may activate an idle supervisor, but they do
 * not own or reset retry timing once supervision has started.
 */
export async function ensureSessionConnectionSupervisionActive(
    supervisor: ManagedConnectionSupervisor,
): Promise<void> {
    if (supervisor.getState().phase !== 'idle') return;
    await supervisor.start();
}

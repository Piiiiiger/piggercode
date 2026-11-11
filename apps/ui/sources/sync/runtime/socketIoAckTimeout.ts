import { createSocketIoAckTimeoutError } from '@piggercode/protocol/rpcErrors';

/** socket.io rejects a call waiting for its answer this way when the connection drops (it reconnects by itself). */
export function isSocketIoDisconnectedError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('socket has been disconnected');
}

export async function raceSocketIoAckTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    if (!(typeof timeoutMs === 'number' && timeoutMs > 0)) {
        return await promise;
    }

    return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(createSocketIoAckTimeoutError());
        }, timeoutMs);

        promise.then(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}

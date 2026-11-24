import { connect, createServer, type AddressInfo } from 'node:net';

import { executeSystemTask } from '@piggercode/cli-common/systemTasks';
import type { SystemTaskResult } from '@piggercode/protocol';
import { describe, expect, it } from 'vitest';

import { createHsetupSystemTaskRegistry } from '../registry.js';

const PAGE = { title: 'Signed in', message: 'You can close this page.' };

function startTask(params: Record<string, unknown>, signal?: AbortSignal) {
  let onListening: (port: number) => void = () => {};
  const listening = new Promise<number>((resolve) => {
    onListening = resolve;
  });
  const result = executeSystemTask({
    spec: {
      protocolVersion: 1,
      kind: 'connectedServices.oauthCallback.v1',
      params: { page: PAGE, timeoutMs: 30_000, ...params },
    },
    taskId: 'task-1',
    registry: createHsetupSystemTaskRegistry(),
    signal,
    emitEvent: (event) => {
      if (event.type === 'listening') onListening((event.data as { port: number }).port);
    },
  });
  return { listening, result };
}

/** The port the task listens on; a task that ends before listening fails the test with its result. */
function listeningPort(task: ReturnType<typeof startTask>): Promise<number> {
  return Promise.race([
    task.listening,
    task.result.then((result: SystemTaskResult) => {
      throw new Error(`the task ended without listening: ${JSON.stringify(result)}`);
    }),
  ]);
}

describe('connectedServices.oauthCallback.v1', () => {
  it('answers the browser with the page and hands back the address it was sent to', async () => {
    const task = startTask({ port: 0, path: '/callback' });
    const port = await listeningPort(task);

    const miss = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(miss.status).toBe(404);
    const hit = await fetch(`http://127.0.0.1:${port}/callback?code=c1&state=s1`);
    expect(hit.status).toBe(200);
    expect(await hit.text()).toContain('You can close this page.');

    await expect(task.result).resolves.toMatchObject({
      ok: true,
      data: { callbackUrl: `http://localhost:${port}/callback?code=c1&state=s1` },
    });
    await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
  });

  it('says the port is taken instead of waiting for a browser that cannot reach it', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    try {
      const taken = (blocker.address() as AddressInfo).port;
      await expect(startTask({ port: taken, path: '/auth/callback' }).result).resolves.toMatchObject({
        ok: false,
        error: { code: 'port_in_use' },
      });
    } finally {
      blocker.close();
    }
  });

  it('frees the port when the app cancels, and when the wait runs out', async () => {
    const controller = new AbortController();
    const cancelled = startTask({ port: 0, path: '/callback' }, controller.signal);
    const port = await listeningPort(cancelled);
    controller.abort();
    await expect(cancelled.result).resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } });
    await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();

    await expect(startTask({ port: 0, path: '/callback', timeoutMs: 1_000 }).result).resolves.toMatchObject({
      ok: false,
      error: { code: 'timeout' },
    });
  });

  it('answers only a plain path on itself, and keeps waiting for the browser', async () => {
    const task = startTask({ port: 0, path: '/callback' });
    const port = await listeningPort(task);
    const rawStatus = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.end('GET //elsewhere.example/callback?code=c0&state=s0 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
      });
      let reply = '';
      socket.on('data', (chunk) => {
        reply += String(chunk);
      });
      socket.on('end', () => resolve(reply.split('\r\n')[0] ?? ''));
      socket.on('error', reject);
    });
    expect(rawStatus).toContain('404');

    await fetch(`http://127.0.0.1:${port}/callback?code=c1&state=s1`);
    await expect(task.result).resolves.toMatchObject({ ok: true, data: { callbackUrl: `http://localhost:${port}/callback?code=c1&state=s1` } });
  });

  it('says a fixed port is taken when another program holds it on IPv6 loopback', async (context) => {
    const blocker = createServer();
    const ipv6 = await new Promise<boolean>((resolve) => {
      blocker.once('error', () => resolve(false));
      blocker.listen(0, '::1', () => resolve(true));
    });
    if (!ipv6) context.skip();
    try {
      const taken = (blocker.address() as AddressInfo).port;
      await expect(startTask({ port: taken, path: '/auth/callback' }).result).resolves.toMatchObject({
        ok: false,
        error: { code: 'port_in_use' },
      });
    } finally {
      blocker.close();
    }
  });

  it('refuses a path it could not match exactly', async () => {
    await expect(startTask({ port: 0, path: 'callback?x=1' }).result).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_params' },
    });
  });
});

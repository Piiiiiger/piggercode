import { vi } from 'vitest';

import type { Metadata } from '@/api/types';

import type { NativeTerminalSessionClient } from './runNativeTerminalSession';

/** The server side of a session (a network boundary): records what the runner tells it. */
export function fakeServerSession() {
  const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
  let metadata: Metadata = {
    path: '/repo',
    host: 'vm',
    homeDir: '/home/u',
    happyHomeDir: '/home/u/.piggercode',
    happyLibDir: '/opt/piggercode',
    happyToolsDir: '/opt/piggercode/tools/unpacked',
  };
  const calls: string[] = [];
  const session = {
    sessionId: 'session-1',
    keepAlive: vi.fn(),
    updateMetadata: vi.fn(async (handler: (current: Metadata) => Metadata) => {
      metadata = handler(metadata);
    }),
    sendSessionDeath: vi.fn(async () => {
      calls.push('death');
    }),
    close: vi.fn(async () => {
      calls.push('close');
    }),
    rpcHandlerManager: {
      registerHandler: (method: string, handler: (raw: unknown) => Promise<unknown>) => {
        handlers.set(method, handler);
      },
    },
  };
  return {
    session: session as unknown as NativeTerminalSessionClient,
    handlers,
    calls,
    metadata: () => metadata,
  };
}

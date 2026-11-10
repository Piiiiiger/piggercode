import { vi } from 'vitest';

import type { Metadata } from '@/api/types';

import type { NativeTerminalControls } from './runNativeTerminal';
import type { NativeTerminalSessionClient } from './runNativeTerminalSession';

/** A session started with nothing chosen in the new-session screen. */
export const NO_CONTROLS: NativeTerminalControls = {
  permissionMode: null,
  agentModeId: null,
  modelId: null,
  configOptionOverrides: null,
};

/** The config choices of the new-session screen (e.g. Codex's thinking), as the session records them. */
export function configOptionOverrides(values: Readonly<Record<string, string>>): NativeTerminalControls['configOptionOverrides'] {
  return {
    v: 1,
    updatedAt: 1,
    overrides: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { updatedAt: 1, value }])),
  };
}

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

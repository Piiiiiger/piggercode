import { accountSettingsParse } from '@piggercode/protocol';
import { vi } from 'vitest';

import type { AgentState, Metadata } from '@/api/types';
import type { SessionEventMessage } from '@/api/session/sessionMessageTypes';

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
  let agentState: AgentState = {};
  const events: SessionEventMessage[] = [];
  const calls: string[] = [];
  const session = {
    sessionId: 'session-1',
    keepAlive: vi.fn(),
    updateMetadata: vi.fn(async (handler: (current: Metadata) => Metadata) => {
      metadata = handler(metadata);
    }),
    getMetadataSnapshot: () => metadata,
    getAgentStateSnapshot: () => agentState,
    updateAgentState: vi.fn(async (handler: (current: AgentState) => AgentState) => {
      agentState = handler(agentState);
    }),
    sendSessionEvent: vi.fn((event: SessionEventMessage) => {
      events.push(event);
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
    events,
    metadata: () => metadata,
    agentState: () => agentState,
  };
}

/** The user's devices behind the push service (a network boundary): records what they would show. */
export function fakePushService() {
  const sent: Array<{ title: string; body: string; data: Record<string, unknown> }> = [];
  return {
    sent,
    sender: {
      sendToAllDevicesAsync: vi.fn(async (title: string, body: string, data: Record<string, unknown>) => {
        sent.push({ title, body, data });
      }),
      sendToAllDevices: vi.fn(),
    },
    /** What the runner needs to reach the user, for an account that never changed its notification settings. */
    notifications: (agentName = 'Claude Code') => ({
      agentName,
      pushSender: {
        sendToAllDevicesAsync: async (title: string, body: string, data: Record<string, unknown>) => {
          sent.push({ title, body, data });
        },
      },
      readAccountSettings: () => ({ settings: accountSettingsParse({}), settingsSecretsReadKeys: [] }),
    }),
  };
}

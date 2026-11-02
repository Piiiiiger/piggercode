import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildProcess, type spawn } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credentials, Settings } from '@/persistence';
import { createApiSessionClientFixture, createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { updateSessionAgentStateWithAck } from '@/api/session/stateUpdates';
import type { AgentState, Metadata } from '@/api/types';
import { SESSION_RPC_METHODS } from '@piggercode/protocol/rpc';
import { SOCKET_RPC_EVENTS } from '@piggercode/protocol/socketRpc';
import { buildCodexAgentRuntimeDescriptor } from '@piggercode/agents';
import { createCodexSharedLocalControl } from '@/backends/codex/localControl/createCodexSharedLocalControl';
import { createCodexSharedAttachArgs } from '@/backends/codex/localControl/createCodexSharedAttachArgs';
import { createAttachedTerminalSupervisor } from '@/agent/localControl/createAttachedTerminalSupervisor';
import { terminalLauncherBoundary, expectTerminalNativeInvocation } from '@/testkit/process/terminalLauncher';
import { createTerminalAttachmentId, readTerminalAttachmentInfo, writeTerminalAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { buildTerminalHostHandleFromAttachmentMetadata } from '@/agent/runtime/terminal/attachmentMetadata';
import { withConfiguredDaemonTestHome } from '@/daemon/testkit/fakeDaemonLifecycle.testkit';
import { acquireSessionRunnerLock } from '@/daemon/sessionRunnerLock';

import { handleAttachCommand } from './attach';

const { mockIo } = vi.hoisted(() => ({ mockIo: vi.fn() }));
// The real command, provider preparation and ACK writer run beneath this network boundary.
vi.mock('socket.io-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('socket.io-client')>(),
  io: mockIo,
}));

function createRunnerControlHarness(metadata: Metadata, sessionId: string, rpcFailure?: 'rejected' | 'malformed') {
  const session = createApiSessionClientFixture({ metadata });
  const rpc = new RpcHandlerManager({
    scopePrefix: sessionId, encryptionMode: 'plain', encryptionKey: new Uint8Array(32),
    encryptionVariant: 'legacy', logger: () => undefined,
  });
  Object.assign(session, { rpcHandlerManager: rpc });
  let relayState: AgentState | null = null;
  let relayVersion = 0;
  const createSocket = () => createApiSessionSocketStub({
    onConnect: (socket) => queueMicrotask(() => socket.trigger('connect')),
    emitWithAck: (event, payload) => {
      expect(event).toBe('update-state');
      // The transport owns version arbitration; the real ACK writer remains below it.
      const request = payload as { expectedVersion: number; agentState: string };
      if (request.expectedVersion !== relayVersion) {
        return { result: 'version-mismatch', agentState: JSON.stringify(relayState), version: relayVersion };
      }
      relayState = JSON.parse(request.agentState) as AgentState;
      return { result: 'success', agentState: request.agentState, version: ++relayVersion };
    },
    emit: (event, args) => {
      if (event !== SOCKET_RPC_EVENTS.CALL) return;
      const request = args[0] as Parameters<typeof rpc.handleRequest>[0];
      const acknowledge = args[1];
      if (typeof acknowledge !== 'function') throw new Error('Missing RPC acknowledgement');
      if (rpcFailure && request.method.endsWith(':switch')) {
        acknowledge(rpcFailure === 'rejected'
          ? { ok: false, error: 'Switch transport rejected' }
          : { ok: true, result: { ok: true } });
        return;
      }
      void rpc.handleRequest(request).then((result) => acknowledge({ ok: true, result }));
    },
  });
  mockIo.mockImplementation(createSocket);
  const runnerSocket = createSocket();
  runnerSocket.connect();
  let runnerState: AgentState | null = null;
  let runnerVersion = 0;
  session.updateAgentState = (handler) => updateSessionAgentStateWithAck({
    socket: runnerSocket, sessionId, sessionEncryptionMode: 'plain',
    encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy',
    getAgentState: () => runnerState, setAgentState: (value) => { runnerState = value; },
    getAgentStateVersion: () => runnerVersion, setAgentStateVersion: (value) => { runnerVersion = value; },
    syncSessionSnapshotFromServer: async () => { runnerState = relayState; runnerVersion = relayVersion; },
    handler,
  });
  return { session, rpc, readRelayState: () => relayState, readRelayVersion: () => relayVersion };
}

describe('piggercode attach', () => {
  const localSettings = { machineId: 'machine-local' } as Settings;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as any);

  beforeEach(() => {
    exitSpy.mockClear();
    // Older host fixtures receive the released switch ACK at the transport boundary.
    // Deciding custody cases replace this with the real runner RPC authority above.
    mockIo.mockReset().mockImplementation(() => createApiSessionSocketStub({
      onConnect: (socket) => queueMicrotask(() => socket.trigger('connect')),
      emit: (event, args) => {
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const acknowledge = args[1];
        if (typeof acknowledge === 'function') acknowledge({ ok: true, result: true });
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects explicit tmux attach for sessions from another machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rawSession = createSessionRecordFixture({
      id: 'sid_remote_tmux_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-remote',
        path: '/tmp/claude-workspace',
        flavor: 'claude',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
          },
        },
      }),
    });

    await expect((handleAttachCommand as any)(['sid_remote_tmux_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async (): Promise<Settings> => ({ machineId: 'machine-local' } as Settings),
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => null,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
    })).rejects.toThrow('process.exit(1)');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session belongs to another machine and cannot be attached from this computer.'));
    errorSpy.mockRestore();
  });

  it('uses local terminal attachment info for tmux-backed attach on the current machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_claude_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
    });
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_claude_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_claude_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'tmux',
        tmux: expect.objectContaining({ target: 'happy:session-1' }),
      }),
    }));
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('keeps persisted Codex ACP terminal attachment exclusive without requesting a shared TUI', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const terminal = { mode: 'tmux', requested: 'tmux', tmux: { target: 'owned:1' } } as const;
    const rawSession = createSessionRecordFixture({
      id: 'test-session-id', active: true, encryptionMode: 'plain',
      metadata: JSON.stringify(createTestMetadata({
        machineId: 'machine-local', flavor: 'codex', terminal,
        agentRuntimeDescriptorV1: buildCodexAgentRuntimeDescriptor({ backendMode: 'acp' }),
      })),
    });
    const focusHost = vi.fn(async () => 0);
    await handleAttachCommand([rawSession.id], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({ version: 1, sessionId: rawSession.id, terminal, updatedAt: 1 }),
      runTmuxAttachFn: focusHost,
    });
    expect(focusHost).toHaveBeenCalledOnce();
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('uses local terminal attachment info for zellij-backed attach on the current machine', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_claude_zellij_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        terminal: {
          mode: 'zellij',
          requested: 'zellij',
          zellij: {
            sessionName: 'happy-zellij',
            paneId: 'terminal_7',
          },
        },
      }),
    });
    const runZellijAttachFn = vi.fn(async () => 0);
    const terminal = {
      mode: 'zellij',
      requested: 'zellij',
      zellij: {
        sessionName: 'happy-zellij',
        paneId: 'terminal_7',
      },
    };

    await (handleAttachCommand as any)(['sid_claude_zellij_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_claude_zellij_1',
        updatedAt: Date.now(),
        terminal,
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
      runZellijAttachFn,
    });

    expect(runZellijAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sid_claude_zellij_1',
      terminal: expect.objectContaining({
        mode: 'zellij',
        zellij: expect.objectContaining({ sessionName: 'happy-zellij', paneId: 'terminal_7' }),
      }),
    }));
  });

  it('requests a remote-control banner refresh when attaching to daemon-started tmux sessions', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_daemon_claude_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: '/tmp/claude-workspace',
        host: 'test',
        flavor: 'claude',
        startedBy: 'daemon',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
    });
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_daemon_claude_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_daemon_claude_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:session-1',
            tmpDir: '/tmp/happy-tmux',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sid_daemon_claude_1',
      refreshRemoteControl: true,
    }));
  });

  it('falls back to persisted local attachment info when session metadata is unavailable', async () => {
    const runTmuxAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_local_1'], {
      readCredentialsFn: async () => null,
      fetchSessionByIdFn: async () => null,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_local_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: {
            target: 'happy:local-1',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn,
    });

    expect(runTmuxAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'tmux',
        tmux: expect.objectContaining({ target: 'happy:local-1' }),
      }),
    }));
  });

  it('falls back to persisted zellij attachment info when session metadata is unavailable', async () => {
    const runZellijAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_local_zellij_1'], {
      readCredentialsFn: async () => null,
      fetchSessionByIdFn: async () => null,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_local_zellij_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'zellij',
          requested: 'zellij',
          zellij: {
            sessionName: 'happy-local-zellij',
            paneId: 'terminal_8',
          },
        },
      }),
      isTmuxAvailableFn: async () => true,
      runProviderAttachFn: vi.fn(async () => false),
      runTmuxAttachFn: vi.fn(async () => 0),
      runZellijAttachFn,
    });

    expect(runZellijAttachFn).toHaveBeenCalledWith(expect.objectContaining({
      terminal: expect.objectContaining({
        mode: 'zellij',
        zellij: expect.objectContaining({ sessionName: 'happy-local-zellij' }),
      }),
    }));
  });

  it('dispatches Windows Terminal host attach for windows terminal metadata', async () => {
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_windows_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: 'C:\\\\workspace',
        host: 'test',
        flavor: 'codex',
        terminal: {
          mode: 'windows_terminal',
          requested: 'windows_terminal',
          windows: {
            host: 'windows_terminal',
            windowId: 'happy-session-1',
          },
        },
      }),
    });
    const runWindowsTerminalAttachFn = vi.fn(async () => 0);

    await (handleAttachCommand as any)(['sid_windows_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => ({
        version: 1,
        sessionId: 'sid_windows_1',
        updatedAt: Date.now(),
        terminal: {
          mode: 'windows_terminal',
          requested: 'windows_terminal',
          windows: {
            host: 'windows_terminal',
            windowId: 'happy-session-1',
          },
        },
      }),
      runProviderAttachFn: vi.fn(async () => 1),
      runTmuxAttachFn: vi.fn(async () => 0),
      runWindowsTerminalAttachFn,
      runWindowsConsoleAttachFn: vi.fn(async () => 0),
    });

    expect(runWindowsTerminalAttachFn).toHaveBeenCalledWith({
      sessionId: 'sid_windows_1',
      terminal: expect.objectContaining({
        mode: 'windows_terminal',
      }),
    });
    expect(mockIo).not.toHaveBeenCalled();
  });

  it('fails with a not-attachable error for hidden Windows sessions', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const credentials: Credentials = {
      token: 'token-1',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const rawSession = createSessionRecordFixture({
      id: 'sid_windows_hidden_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        path: 'C:\\\\workspace',
        host: 'test',
        flavor: 'codex',
        terminal: {
          mode: 'plain',
          requested: 'windows_terminal',
          fallbackReason: 'started hidden on Windows',
        },
      }),
    });

    await expect((handleAttachCommand as any)(['sid_windows_hidden_1'], {
      readCredentialsFn: async () => credentials,
      readSettingsFn: async () => localSettings,
      fetchSessionByIdFn: async () => rawSession,
      readTerminalAttachmentInfoFn: async () => null,
      runProviderAttachFn: vi.fn(async () => 1),
      runTmuxAttachFn: vi.fn(async () => 0),
      runWindowsTerminalAttachFn: vi.fn(async () => 0),
      runWindowsConsoleAttachFn: vi.fn(async () => 0),
    })).rejects.toThrow('process.exit(1)');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('This Windows session was started hidden and cannot be attached later.'));
    errorSpy.mockRestore();
  });
});

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import type {
  CapabilitiesDetectRequest,
  CapabilitiesDetectResponse,
  CapabilitiesInvokeRequest,
  CapabilitiesInvokeResponse,
} from '@/capabilities/types';
import { codexAcpBinPath, codexAcpInstallDir } from '@/capabilities/deps/codexAcp';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';

import { registerCapabilitiesHandlers } from './capabilities';
import { createEncryptedRpcTestClient } from './encryptedRpc.testkit';

describe('agent CLIs on a computer that runs no agents', () => {
  let workDir = '';
  afterEach(() => {
    vi.unstubAllEnvs();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    rmSync(codexAcpInstallDir(), { recursive: true, force: true });
  });

  function computerWithoutAgents() {
    // What the desktop app writes into the background service it installs.
    vi.stubEnv('PIGGERCODE_DAEMON_SERVICE_MANAGED_BY', 'desktop');
    // The person's own Codex and its ACP helper are installed there (on PATH, and the helper also
    // where the app installs it): each leaves a mark whenever anything runs it.
    workDir = mkdtempSync(join(tmpdir(), 'happier-no-agents-'));
    const ran = join(workDir, 'agent-ran');
    const agent = `#!/bin/sh\necho ran >> "${ran}"\necho "codex-cli 0.164.0"\n`;
    writeExecutableShimSync({ dir: workDir, fileName: 'codex', contents: agent });
    writeExecutableShimSync({ dir: workDir, fileName: 'codex-acp', contents: agent });
    mkdirSync(dirname(codexAcpBinPath()), { recursive: true });
    writeExecutableShimSync({ dir: dirname(codexAcpBinPath()), fileName: basename(codexAcpBinPath()), contents: agent });
    vi.stubEnv('PATH', workDir);
    vi.stubEnv('PIGGERCODE_CODEX_PATH', '');
    vi.stubEnv('PIGGERCODE_CLAUDE_PATH', '');
    const { call } = createEncryptedRpcTestClient({
      scopePrefix: 'machine-capabilities-no-agents',
      registerHandlers: (manager) => registerCapabilitiesHandlers(manager),
    });
    return { call, ran };
  }

  it('refuses to install, update or probe Codex, Claude Code and their helpers there', async () => {
    const { call, ran } = computerWithoutAgents();

    const requests: CapabilitiesInvokeRequest[] = [
      { id: 'cli.codex', method: 'install', params: { intent: 'update' } },
      { id: 'cli.codex', method: 'install', params: {} },
      { id: 'cli.claude', method: 'install', params: { intent: 'update' } },
      { id: 'cli.claude', method: 'probeModels', params: {} },
      { id: 'dep.codex-acp', method: 'upgrade', params: {} },
      { id: 'dep.codex-acp', method: 'install', params: {} },
    ];
    for (const request of requests) {
      const result = await call<CapabilitiesInvokeResponse, CapabilitiesInvokeRequest>(RPC_METHODS.CAPABILITIES_INVOKE, request);
      expect(result).toMatchObject({ ok: false, error: { code: 'agents-not-hosted' } });
    }
    expect(existsSync(ran)).toBe(false);
  });

  it('finds none of them there, and runs nothing to find out', async () => {
    const { call, ran } = computerWithoutAgents();

    const detected = await call<CapabilitiesDetectResponse, CapabilitiesDetectRequest>(RPC_METHODS.CAPABILITIES_DETECT, {
      requests: [
        { id: 'cli.codex', params: { includeAcpCapabilities: true, includeLatestVersion: true, includeLoginStatus: true } },
        { id: 'cli.claude', params: { includeLatestVersion: true } },
        { id: 'dep.codex-acp', params: { includeLatestVersion: true } },
      ],
      bypassCache: true,
    });

    expect(detected.results['cli.codex']).toMatchObject({ ok: true, data: { available: false } });
    expect(detected.results['cli.claude']).toMatchObject({ ok: true, data: { available: false } });
    expect(detected.results['dep.codex-acp']).toMatchObject({ ok: true, data: { installed: false } });
    expect(existsSync(ran)).toBe(false);
  });
});

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgyAccountUsageReadResponseV1Schema, type AgyAccountUsageReportV1 } from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { afterEach, describe, expect, it } from 'vitest';

import {
  startConnectedServicesCodexDaemon,
  startFakeTokenServer,
  type StartedConnectedServicesCodexDaemonFixture,
} from '../../src/testkit/connectedServicesCodexDaemon';
import { daemonControlPostJson } from '../../src/testkit/daemon/controlServerClient';
import { createRunDirs } from '../../src/testkit/runDir';
import { createUserScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { createDataKeyRpcClient, unwrapDataKeyRpcResult } from '../../src/testkit/syntheticAgent/rpcClient';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({ runLabel: 'core' });
const EMAIL = 'gemini-usage-e2e@example.test';
const SECOND_EMAIL = 'second@example.test';

/**
 * Plays agy, which reports limits for the account named after its `HOME` through the title command and runs on,
 * and tmux, which starts it in its own process group and stops it.
 */
async function installFakeAgy(testDir: string): Promise<string> {
  const bin = join(testDir, 'fake-agy-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'agy'), `#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
appendFileSync(${JSON.stringify(join(bin, 'pids'))}, process.pid + '\\n');
const setting = process.argv.find((arg) => arg.startsWith('--settings='));
const title = JSON.parse(setting.slice('--settings='.length)).title;
const status = {
  email: basename(process.env.HOME) + '@example.test',
  plan_tier: 'pro',
  quota: { 'gemini-5h': { remaining_fraction: 0.25, reset_time: new Date(Date.now() + 3600000).toISOString() } },
};
execSync(title.command, { input: JSON.stringify(status), shell: '/bin/sh' });
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  await writeFile(join(bin, 'tmux'), `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const pidFile = args[args.indexOf('-S') + 1] + '.pid';
if (args.includes('kill-server')) {
  try { process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {}
  process.exit(0);
}
const folder = args.indexOf('-c');
const [command, ...rest] = args.slice(folder + 2);
const child = spawn(command, rest, { cwd: args[folder + 1], detached: true, stdio: 'ignore' });
writeFileSync(pidFile, String(child.pid));
console.log(child.pid);
child.unref();
`, { mode: 0o755 });
  return bin;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function filesHolding(dir: string, needle: string, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip.has(path)) continue;
    if (entry.isDirectory()) found.push(...await filesHolding(path, needle, skip));
    else if (entry.isFile() && (await readFile(path)).includes(needle)) found.push(path);
  }
  return found;
}

describe('core e2e: agy account usage', () => {
  let fixture: StartedConnectedServicesCodexDaemonFixture | null = null;
  let tokenServer: Awaited<ReturnType<typeof startFakeTokenServer>> | null = null;
  let ui: SocketCollector | null = null;

  afterEach(async () => {
    ui?.close();
    await fixture?.daemon.stop().catch(() => {});
    await fixture?.server.stop().catch(() => {});
    await tokenServer?.stop().catch(() => {});
    ui = null;
    fixture = null;
    tokenServer = null;
  }, 60_000);

  it('keeps a session\'s reading on its machine and serves it through the encrypted machine RPC', async () => {
    const testDir = run.testDir('agy-account-usage');
    tokenServer = await startFakeTokenServer({
      respond: () => ({
        status: 200,
        body: {
          access_token: 'access-refreshed',
          refresh_token: 'refresh-refreshed',
          id_token: 'id-refreshed',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      }),
    });
    const features = {
      PIGGERCODE_FEATURE_CONNECTED_SERVICES__ENABLED: '1',
      PIGGERCODE_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED: '0',
      PIGGERCODE_FEATURE_CONNECTED_SERVICES_SUBSCRIPTION__ENABLED: '0',
    };
    const fakeAgyBin = await installFakeAgy(testDir);
    fixture = await startConnectedServicesCodexDaemon({
      testDir,
      testName: 'agy-account-usage',
      tokenUrl: tokenServer.tokenUrl,
      accessToken: 'access-initial',
      refreshToken: 'refresh-initial',
      idToken: 'id-initial',
      expiresAt: Date.now() + 6 * 60 * 60_000,
      authMode: 'dataKey',
      serverExtraEnv: features,
      daemonExtraEnv: { ...features, PATH: `${fakeAgyBin}:${process.env.PATH ?? ''}` },
    });
    const started = fixture;

    // What an agy session's follower sends its daemon.
    const report: AgyAccountUsageReportV1 = {
      email: EMAIL,
      planTier: 'pro',
      observedAtMs: Date.now(),
      meters: [{ meterId: 'gemini-5h', remainingFraction: 0.42, resetAtMs: Date.now() + 3_600_000 }],
    };
    const posted = await daemonControlPostJson({
      port: started.daemonPort,
      path: '/agy-account-usage',
      body: report,
      controlToken: started.controlToken,
    });
    expect(posted.status).toBe(200);

    ui = createUserScopedSocketCollector(started.serverBaseUrl, started.auth.token);
    ui.connect();
    await waitFor(() => ui?.isConnected() === true, { timeoutMs: 20_000, context: 'user socket connected' });
    const machineRpc = createDataKeyRpcClient(ui, started.machineKey!);
    const read = async (request: Record<string, string> = {}) => AgyAccountUsageReadResponseV1Schema.parse(
      await unwrapDataKeyRpcResult(
        await machineRpc.call(`${started.machineId}:${RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ}`, request, 30_000),
        'agy account usage',
      ),
    );
    await waitFor(async () => {
      const answer = await read().catch(() => null);
      return answer?.ok === true && answer.accounts.length === 1;
    }, { timeoutMs: 60_000, context: 'usage read through the machine RPC' });
    expect(await read()).toMatchObject({
      ok: true,
      accounts: [{
        accountId: 'default',
        email: EMAIL,
        planTier: 'pro',
        meters: [{ meterId: 'gemini-5h', remainingFraction: 0.42 }],
      }],
    });

    // A second login is a folder. Listing it starts nothing; the refresh button starts agy once on it.
    await mkdir(join(started.daemonHomeDir, 'agy-accounts', 'second'), { recursive: true });
    expect(await read()).toMatchObject({
      ok: true,
      accounts: [{ accountId: 'default' }, { accountId: 'second', email: null, observedAtMs: null, meters: [] }],
    });
    await expect(readFile(join(fakeAgyBin, 'pids'), 'utf8')).rejects.toThrow();

    expect(await read({ refreshAccountId: 'second' })).toMatchObject({
      ok: true,
      refreshed: true,
      accounts: [
        { accountId: 'default', email: EMAIL },
        {
          accountId: 'second',
          email: SECOND_EMAIL,
          meters: [{ meterId: 'gemini-5h', remainingFraction: 0.25 }],
        },
      ],
    });
    const pids = (await readFile(join(fakeAgyBin, 'pids'), 'utf8')).trim().split('\n').map(Number);
    expect(pids).toHaveLength(1);
    await waitFor(() => !isRunning(pids[0]!), { timeoutMs: 10_000, context: 'the agy started for the read stopped' });

    ui.close();
    ui = null;
    await started.daemon.stop();
    await started.server.stop();

    // On the machine it is in the one usage file, and in no log.
    expect(await filesHolding(started.daemonHomeDir, EMAIL)).toEqual([
      join(started.daemonHomeDir, 'servers', started.serverId, 'agy-account-usage.json'),
    ]);
    // The relay's data does hold this machine, so the search reads it, and holds no account.
    expect(await filesHolding(started.server.dataDir, started.machineId)).not.toEqual([]);
    for (const email of [EMAIL, SECOND_EMAIL]) {
      expect(await filesHolding(started.server.dataDir, email)).toEqual([]);
      expect(await filesHolding(testDir, email, new Set([started.daemonHomeDir]))).toEqual([]);
    }
  }, 240_000);
});

import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createServer } from 'node:http';

import {
  ProviderAccountUsageSnapshotV1Schema,
  openProviderAccountUsageSnapshotCiphertext,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import {
  startConnectedServicesCodexDaemon,
  startFakeTokenServer,
  type StartedConnectedServicesCodexDaemonFixture,
} from '../../src/testkit/connectedServicesCodexDaemon';
import { fetchJson } from '../../src/testkit/http';
import { createRunDirs } from '../../src/testkit/runDir';
import { createUserScopedSocketCollector, type SocketCollector } from '../../src/testkit/socketClient';
import { createDataKeyRpcClient, unwrapDataKeyRpcResult } from '../../src/testkit/syntheticAgent/rpcClient';
import { waitFor } from '../../src/testkit/timing';

const run = createRunDirs({ runLabel: 'core' });

async function startFakeCodexUsage(initialUsedPercent: number) {
  let usedPercent = initialUsedPercent;
  let reads = 0;
  const startedAtSeconds = Math.floor(Date.now() / 1000);
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (!request.url?.startsWith('/usage')) {
      response.statusCode = 404;
      response.end('{}');
      return;
    }
    reads += 1;
    response.end(JSON.stringify({
      plan_type: 'team',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: usedPercent,
          limit_window_seconds: 18_000,
          reset_after_seconds: 9_000,
          reset_at: startedAtSeconds + 9_000,
        },
        secondary_window: {
          used_percent: 1,
          limit_window_seconds: 604_800,
          reset_after_seconds: 300_000,
          reset_at: startedAtSeconds + 300_000,
        },
      },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('fake usage server missing address');
  return {
    url: `http://127.0.0.1:${address.port}/usage`,
    reads: () => reads,
    setUsedPercent: (next: number) => { usedPercent = next; },
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function readStoredUsage(fixture: StartedConnectedServicesCodexDaemonFixture) {
  const response = await fetchJson<{
    sealed?: { ciphertext: string };
    metadata?: { fetchedAt: number };
  }>(`${fixture.serverBaseUrl}/v2/connect/openai-codex/profiles/work/quotas`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${fixture.auth.token}` },
    timeoutMs: 20_000,
  });
  if (response.status !== 200 || !response.data?.sealed || !response.data.metadata) return null;
  const opened = openProviderAccountUsageSnapshotCiphertext({
    material: { type: 'dataKey', machineKey: fixture.machineKey! },
    ciphertext: response.data.sealed.ciphertext,
  });
  const session = ProviderAccountUsageSnapshotV1Schema.parse(opened?.value).meters
    .find((meter) => meter.meterId === 'session');
  return session ? { fetchedAt: response.data.metadata.fetchedAt, sessionRemainingPct: session.remainingPct } : null;
}

describe('core e2e: connected-service usage refresh on the managing machine', () => {
  let fixture: StartedConnectedServicesCodexDaemonFixture | null = null;
  let tokenServer: Awaited<ReturnType<typeof startFakeTokenServer>> | null = null;
  let usage: Awaited<ReturnType<typeof startFakeCodexUsage>> | null = null;
  let ui: SocketCollector | null = null;

  afterEach(async () => {
    ui?.close();
    await fixture?.daemon.stop().catch(() => {});
    await fixture?.server.stop().catch(() => {});
    await tokenServer?.stop().catch(() => {});
    await usage?.stop().catch(() => {});
    ui = null;
    fixture = null;
    tokenServer = null;
    usage = null;
  }, 60_000);

  it('answers only after the new reading is stored, even when the numbers did not change', async () => {
    const testDir = run.testDir('connected-services-quotas-refresh-now');
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
    usage = await startFakeCodexUsage(10);
    const features = {
      PIGGERCODE_FEATURE_CONNECTED_SERVICES__ENABLED: '1',
      PIGGERCODE_FEATURE_CONNECTED_SERVICES_QUOTAS__ENABLED: '1',
      PIGGERCODE_FEATURE_CONNECTED_SERVICES_SUBSCRIPTION__ENABLED: '0',
    };
    fixture = await startConnectedServicesCodexDaemon({
      testDir,
      testName: 'connected-services-quotas-refresh-now',
      tokenUrl: tokenServer.tokenUrl,
      accessToken: 'access-initial',
      refreshToken: 'refresh-initial',
      idToken: 'id-initial',
      expiresAt: Date.now() + 6 * 60 * 60_000,
      authMode: 'dataKey',
      managedByThisMachine: true,
      serverExtraEnv: features,
      daemonExtraEnv: {
        ...features,
        PIGGERCODE_CONNECTED_SERVICES_OPENAI_CODEX_USAGE_URL: usage.url,
        PIGGERCODE_CONNECTED_SERVICES_DISABLE_CODEX_SUBSCRIPTION_ENDPOINT: '1',
        // A regular round cannot serve the refresh during this test.
        PIGGERCODE_CONNECTED_SERVICES_QUOTAS_TICK_MS: String(30 * 60_000),
      },
    });
    const started = fixture;
    ui = createUserScopedSocketCollector(started.serverBaseUrl, started.auth.token);
    ui.connect();
    await waitFor(() => ui?.isConnected() === true, { timeoutMs: 20_000, context: 'user socket connected' });
    const machineRpc = createDataKeyRpcClient(ui, started.machineKey!);
    const runRound = async () => unwrapDataKeyRpcResult(await machineRpc.call(
      `${started.machineId}:${RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_REFRESH}`,
      {},
      30_000,
    ), 'usage round');
    const pressRefresh = async () => {
      const stored = await fetchJson<{ success?: boolean }>(
        `${started.serverBaseUrl}/v2/connect/openai-codex/profiles/work/quotas/refresh`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${started.auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          timeoutMs: 20_000,
        },
      );
      expect(stored.status).toBe(200);
      return await runRound();
    };

    await waitFor(async () => {
      const answer = await runRound().catch(() => null) as { ok?: boolean } | null;
      return answer?.ok === true && (await readStoredUsage(started))?.sessionRemainingPct === 90;
    }, { timeoutMs: 90_000, context: 'first usage reading stored' });

    usage.setUsedPercent(42);
    const readsBefore = usage.reads();
    await expect(pressRefresh()).resolves.toEqual({ ok: true });
    const changed = await readStoredUsage(started);
    expect(changed?.sessionRemainingPct).toBe(58);
    expect(usage.reads()).toBe(readsBefore + 1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(pressRefresh()).resolves.toEqual({ ok: true });
    const unchanged = await readStoredUsage(started);
    expect(unchanged?.sessionRemainingPct).toBe(58);
    expect(unchanged?.fetchedAt).toBeGreaterThan(changed!.fetchedAt);
    expect(usage.reads()).toBe(readsBefore + 2);

    await expect(runRound()).resolves.toEqual({ ok: true });
    expect(usage.reads()).toBe(readsBefore + 2);
  }, 240_000);
});

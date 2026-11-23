import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildConnectedServiceCredentialRecord, type ConnectedServiceCredentialRecordV1 } from '@piggercode/protocol';

import type { ApiClient } from '@/api/api';
import type { Credentials } from '@/persistence';
import { writeCodexAuthStoreFile } from '@/backends/codex/connectedServices/writeCodexAuthStoreFile';
import { resolveConnectedServiceHomeDir } from '../homes/resolveConnectedServiceHomeDir';
import { createManagingMachineConnectedServiceManagement } from '../management/connectedServiceManagement.testkit';
import { ConnectedServiceManagementAuthority, type ConnectedServiceManagement } from '../management/connectedServiceManagement';
import { computeConnectedServiceAccessTokenFingerprint } from './credentialFreshness/tokenFingerprint';
import { ConnectedServiceRefreshCoordinator } from './ConnectedServiceRefreshCoordinator';
import { ConnectedServiceRuntimeRegistry } from '../runtimeRegistry/registry';
import { registerConnectedServiceTrackedSessionTargetsForDaemon } from '../startup/runtimeTargetRegistration';
import {
  PIGGERCODE_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
  serializeConnectedServiceChildSelections,
} from '../connectedServiceChildEnvironment';

const NOW = 1_700_000_000_000;
const credentials = { token: 'happy-token', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) } } satisfies Credentials;

function jwtExpiringAt(expiresAtMs: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: Math.trunc(expiresAtMs / 1000) })}.sig`;
}

function codexLogin(
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  origin: 'fresh_authorization' | 'unmarked' = 'fresh_authorization',
): ConnectedServiceCredentialRecordV1 {
  return buildConnectedServiceCredentialRecord({
    now: NOW,
    serviceId: 'openai-codex',
    profileId: 'work',
    kind: 'oauth',
    expiresAt,
    oauth: {
      accessToken, refreshToken, idToken: null, scope: null, tokenType: null,
      providerAccountId: 'acct', providerEmail: null, raw: origin === 'unmarked' ? {} : { credentialOrigin: origin },
    },
  });
}

/** The relay boundary: one plaintext credential with compare-and-set writes. */
function createRelay(initial: ConnectedServiceCredentialRecordV1) {
  const state = {
    record: initial, revision: 'csr_0000000000000000000001', writes: 0, failWrites: false, loseNextAnswer: false,
    /** The next write times out for the daemon but stays in flight; `commitLate()` lands it afterwards. */
    delayNextCommit: false,
    commitLate: null as null | (() => void),
  };
  const api = {
    getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
    getConnectedServiceCredentialPlain: vi.fn(async () => ({
      revisionSemantics: 'revisioned' as const,
      credentialRevision: state.revision,
      content: { t: 'plain' as const, v: state.record },
    })),
    getConnectedServiceCredentialSealed: vi.fn(async () => null),
    registerConnectedServiceCredentialPlain: vi.fn(async (params: Readonly<{
      content: { v: ConnectedServiceCredentialRecordV1 };
      expectedCredentialRevision?: string;
    }>) => {
      if (state.failWrites) throw new Error('relay unreachable');
      if (state.delayNextCommit) {
        state.delayNextCommit = false;
        state.commitLate = () => {
          if (params.expectedCredentialRevision !== state.revision) return;
          state.writes += 1;
          state.record = params.content.v;
          state.revision = `csr_${String(state.writes + 1).padStart(22, '0')}`;
        };
        throw new Error('timed out');
      }
      if (params.expectedCredentialRevision !== state.revision) {
        return { error: 'connect_credential_mutation_superseded' as const, reason: 'revision_mismatch' as const, credentialRevision: state.revision };
      }
      state.writes += 1;
      state.record = params.content.v;
      state.revision = `csr_${String(state.writes + 1).padStart(22, '0')}`;
      if (state.loseNextAnswer) {
        // The write committed, but the connection dropped before its answer arrived.
        state.loseNextAnswer = false;
        throw new Error('connection reset');
      }
      return { success: true as const, credentialRevision: state.revision };
    }),
    acquireConnectedServiceRefreshLease: vi.fn(async () => ({
      acquired: true, leaseUntil: NOW + 60_000, ownerId: 'machine-1:runtime', credentialRevision: state.revision,
    })),
    updateConnectedServiceCredentialHealth: vi.fn(async () => ({ success: true })),
    listConnectedServiceProfiles: vi.fn(async () => ({ serviceId: 'openai-codex', profiles: [{ profileId: 'work', status: 'connected' }] })),
  };
  return { api: api as unknown as ApiClient, calls: api, state };
}

async function createCodexHome(activeServerDir: string, record: ConnectedServiceCredentialRecordV1): Promise<string> {
  const codexHome = join(resolveConnectedServiceHomeDir({
    activeServerDir, serviceId: 'openai-codex', profileId: 'work', agentId: 'codex',
  }), 'codex-home');
  await writeCodexAuthStoreFile({ codexHome, record });
  return codexHome;
}

/** The running Codex CLI refreshed its login and rewrote auth.json. */
async function rotateInCli(codexHome: string, accessToken: string, refreshToken: string): Promise<void> {
  const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')) as Record<string, unknown>;
  await writeFile(join(codexHome, 'auth.json'), JSON.stringify({
    ...auth,
    tokens: { access_token: accessToken, refresh_token: refreshToken, id_token: null, account_id: 'acct' },
    last_refresh: new Date(NOW).toISOString(),
  }));
}

async function setup(record: ConnectedServiceCredentialRecordV1, options: Readonly<{ management?: ConnectedServiceManagement }> = {}) {
  const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-native-ownership-'));
  const baseDir = await mkdtemp(join(tmpdir(), 'happier-native-ownership-materialized-'));
  const relay = createRelay(record);
  const codexHome = await createCodexHome(activeServerDir, record);
  const providerFetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ access_token: jwtExpiringAt(NOW + 3_600_000), refresh_token: 'daemon-refresh', id_token: 'new-id', expires_in: 3600 }),
  }));
  vi.stubGlobal('fetch', providerFetch as unknown as typeof fetch);
  const onAuthUpdated = vi.fn();
  const runtimeRegistry = new ConnectedServiceRuntimeRegistry();
  const coordinator = new ConnectedServiceRefreshCoordinator({
    runtimeRegistry,
    management: options.management ?? createManagingMachineConnectedServiceManagement(),
    api: relay.api,
    credentials,
    machineIdProvider: () => 'machine-1',
    activeServerDir,
    baseDir,
    refreshWindowMs: 60_000,
    refreshLeaseMs: 30_000,
    now: () => NOW,
    onAuthUpdated,
  });
  const registerCodexTerminal = (
    pid: number,
    accessTokenRefresh?: Readonly<{ mode: 'daemon_callback'; serviceIds: ['openai-codex'] }>,
  ) => coordinator.registerSpawnTarget({
    pid,
    ...(accessTokenRefresh ? { accessTokenRefresh } : {}),
    agentId: 'codex',
    sessionId: `session-${pid}`,
    connectedServicesBindingsRaw: { v: 1, bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } } },
    materializationKey: `session-${pid}`,
    connectedServiceSelectionsEnv: {
      [PIGGERCODE_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: serializeConnectedServiceChildSelections(new Map([[
        'openai-codex',
        { kind: 'profile', serviceId: 'openai-codex', profileId: 'work', credentialRevision: relay.state.revision },
      ]])) ?? '',
    },
  });
  return { coordinator, runtimeRegistry, relay, codexHome, providerFetch, onAuthUpdated, registerCodexTerminal };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConnectedServiceRefreshCoordinator: logins a running native client owns (I2)', () => {
  it('never rotates a login a running Codex terminal owns, and reads its rotations back without touching the terminal', async () => {
    const { coordinator, runtimeRegistry, relay, codexHome, providerFetch, onAuthUpdated, registerCodexTerminal } = await setup(
      codexLogin('access-0', 'refresh-0', NOW + 30_000), // inside the refresh window
    );
    registerCodexTerminal(101);
    // Deleting the login now would strand the running terminal's token.
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ status: 'in_use', reason: 'terminal' });

    // Every refresh entry leaves the rotation to the CLI.
    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    await coordinator.tickOnce();
    await expect(coordinator.refreshConnectedServiceCredentialForSpawnPreflight({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toMatchObject({ status: 'not_needed', heldByNativeClient: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(relay.calls.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(relay.state.writes).toBe(0);

    // The CLI rotates; the next refresh reads that rotation back (compare-and-set on the base revision).
    const rotatedAccess = jwtExpiringAt(NOW + 3_600_000);
    await rotateInCli(codexHome, rotatedAccess, 'refresh-1');
    const baseRevision = relay.state.revision;
    await coordinator.tickOnce();
    expect(relay.calls.registerConnectedServiceCredentialPlain).toHaveBeenCalledWith(expect.objectContaining({
      expectedCredentialRevision: baseRevision,
    }));
    expect(relay.state.record).toMatchObject({
      expiresAt: NOW + 3_600_000,
      oauth: { accessToken: rotatedAccess, refreshToken: 'refresh-1', raw: { credentialOrigin: 'fresh_authorization' } },
    });
    expect(providerFetch).not.toHaveBeenCalled();
    // The terminal produced that login: its new revision is recorded as applied, not as a switch to A.
    expect(runtimeRegistry.getBySessionId('session-101')?.connectedServiceSelections).toEqual([
      expect.objectContaining({ profileId: 'work', credentialRevision: relay.state.revision }),
    ]);
    // Reading back neither rewrites the home nor restarts the terminal, also when the relay echoes it.
    await coordinator.handleExternalCredentialUpdate({
      serviceId: 'openai-codex',
      profileId: 'work',
      credentialBoundary: { status: 'present', revisionSemantics: 'revisioned', credentialRevision: relay.state.revision },
      executionAuthority: 'passive_projection',
    });
    expect(onAuthUpdated).not.toHaveBeenCalled();
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')) as { tokens: { refresh_token: string } };
    expect(auth.tokens.refresh_token).toBe('refresh-1');

    // Nothing more to read back: no second write.
    await coordinator.tickOnce();
    expect(relay.state.writes).toBe(1);
  });

  it('leaves a held login alone from the bridge and runtime-auth-failure entries as well', async () => {
    const { coordinator, relay, providerFetch, registerCodexTerminal } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    registerCodexTerminal(101);
    // A runtime that asks the daemon for tokens, on the same login the terminal owns.
    registerCodexTerminal(102, { mode: 'daemon_callback', serviceIds: ['openai-codex'] });

    await expect(coordinator.refreshOpenAiCodexChatGptTokensForBridge({
      sessionId: 'session-102',
      selection: { kind: 'profile', serviceId: 'openai-codex', profileId: 'work' },
      chatgptPlanType: 'plus',
      forceRefresh: true,
      failingAccessTokenFingerprint: computeConnectedServiceAccessTokenFingerprint('access-0'),
    })).rejects.toThrow();
    await expect(coordinator.refreshConnectedServiceCredentialForRuntimeAuthFailure({
      serviceId: 'openai-codex',
      profileId: 'work',
      sessionId: 'session-102',
    })).resolves.toMatchObject({ heldByNativeClient: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(relay.calls.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(relay.state.writes).toBe(0);
  });

  it('rotates nothing from any of the five entries on a machine that does not manage subscription logins', async () => {
    const management = new ConnectedServiceManagementAuthority({
      machineId: () => 'machine-1',
      readSettings: () => ({ connectedServicesManagementV1: { v: 1, managingMachineId: 'machine-2', poolsPaused: false } }),
    });
    management.confirmSettingsRead(management.beginConnection());
    const { coordinator, relay, providerFetch, registerCodexTerminal } = await setup(
      codexLogin('access-0', 'refresh-0', NOW + 30_000), // inside the refresh window
      { management },
    );
    // No native owner here: only the management decision keeps these entries from rotating.
    registerCodexTerminal(102, { mode: 'daemon_callback', serviceIds: ['openai-codex'] });

    await coordinator.tickOnce();
    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toEqual({ record: null, reauthRequired: false });
    await expect(coordinator.refreshConnectedServiceCredentialForSpawnPreflight({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toMatchObject({ status: 'lease_not_acquired', credential: null });
    await expect(coordinator.refreshOpenAiCodexChatGptTokensForBridge({
      sessionId: 'session-102',
      selection: { kind: 'profile', serviceId: 'openai-codex', profileId: 'work' },
      chatgptPlanType: 'plus',
      forceRefresh: true,
      failingAccessTokenFingerprint: computeConnectedServiceAccessTokenFingerprint('access-0'),
    })).rejects.toThrow();
    await expect(coordinator.refreshConnectedServiceCredentialForRuntimeAuthFailure({
      serviceId: 'openai-codex',
      profileId: 'work',
      sessionId: 'session-102',
    })).resolves.toMatchObject({ status: 'lease_not_acquired' });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(relay.calls.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(relay.state.writes).toBe(0);
  });

  it('reads the rotation of an exited terminal back, and does not rotate a spent token while that fails', async () => {
    const { coordinator, relay, codexHome, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 3_600_000), 'refresh-1'); // the CLI rotated, then exited

    relay.state.failWrites = true;
    // The newest login is in the home, not dead: a refused usage request must not count toward
    // "reconnect required" while the upload keeps failing.
    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ status: 'in_use', reason: 'rotation_not_read_back' });
    // refresh-0 is spent; rotating it would log the account out.
    expect(providerFetch).not.toHaveBeenCalled();

    relay.state.failWrites = false;
    const result = await coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    expect(result.record).toMatchObject({ oauth: { refreshToken: 'refresh-1' } });
    expect(providerFetch).not.toHaveBeenCalled();
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' })).resolves.toEqual({ status: 'free' });

    // Once read back, the daemon owns the login again and rotates it normally.
    await coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'daemon-refresh' } });
  });

  it('reads the next rotation back when the relay took the last one but its answer was lost', async () => {
    const { coordinator, relay, codexHome, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 3_600_000), 'refresh-1');
    relay.state.loseNextAnswer = true;
    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-1' } });
    expect(relay.state.writes).toBe(1);

    // Reconciled without uploading the same login again.
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    expect(relay.state.writes).toBe(1);
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' })).resolves.toEqual({ status: 'free' });

    // The same loss again, and then the terminal rotates once more before it exits: that rotation
    // is the only valid login and must reach the relay on top of the one the relay took.
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 5_400_000), 'refresh-2');
    relay.state.loseNextAnswer = true;
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    const takenRevision = relay.state.revision;
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 7_200_000), 'refresh-3');
    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toMatchObject({ record: { oauth: { refreshToken: 'refresh-3' } } });
    expect(relay.calls.registerConnectedServiceCredentialPlain).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedCredentialRevision: takenRevision,
    }));
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-3' } });

    // Two different failures in a row: the relay takes a rotation without answering, and the upload of the
    // next one fails before it commits. The relay's login (the first one) stays the base for the retry.
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 9_000_000), 'refresh-4');
    relay.state.loseNextAnswer = true;
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    const secondTakenRevision = relay.state.revision;
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 10_800_000), 'refresh-5');
    relay.state.failWrites = true;
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    relay.state.failWrites = false;
    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toMatchObject({ record: { oauth: { refreshToken: 'refresh-5' } } });
    expect(relay.calls.registerConnectedServiceCredentialPlain).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedCredentialRevision: secondTakenRevision,
    }));
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('keeps a rotation when an earlier upload that timed out commits after it', async () => {
    const { coordinator, relay, codexHome, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 3_600_000), 'refresh-1'); // A→B
    relay.state.delayNextCommit = true; // B's upload times out but is still on its way
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-0' } });

    await rotateInCli(codexHome, jwtExpiringAt(NOW + 7_200_000), 'refresh-2'); // B→C
    const commitBDuringC = relay.calls.registerConnectedServiceCredentialPlain.getMockImplementation()!;
    relay.calls.registerConnectedServiceCredentialPlain.mockImplementationOnce(async (params) => {
      relay.state.commitLate?.(); // B lands first: C's compare-and-set against A now fails
      return await commitBDuringC(params);
    });
    await coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' });
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-1' } });
    const bRevision = relay.state.revision;

    // C is the only valid login: it must reach the relay on top of B.
    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toMatchObject({ record: { oauth: { refreshToken: 'refresh-2' } } });
    expect(relay.calls.registerConnectedServiceCredentialPlain).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedCredentialRevision: bRevision,
    }));
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('leaves a login to a home it cannot read: no rotation, no "reconnect", no delete clearance', async () => {
    const { coordinator, codexHome, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    await rm(join(codexHome, 'auth.json'));
    await mkdir(join(codexHome, 'auth.json')); // reading it fails (EISDIR), as an I/O error would

    await expect(coordinator.readBackNativeCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    expect(providerFetch).not.toHaveBeenCalled();
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ status: 'in_use', reason: 'rotation_not_read_back' });
  });

  it('reports a login in use while any terminal runs on it, whatever refreshes its tokens', async () => {
    const { coordinator, registerCodexTerminal } = await setup(codexLogin('access-0', 'refresh-0', NOW + 3_600_000));
    // A Codex runtime that asks the daemon for its tokens does not own the login, but still needs it.
    registerCodexTerminal(211, { mode: 'daemon_callback', serviceIds: ['openai-codex'] });
    await expect(coordinator.describeLoginUse({ serviceId: 'openai-codex', profileId: 'work' }))
      .resolves.toEqual({ status: 'in_use', reason: 'terminal' });

    // A Claude terminal: the daemon keeps its refresh token, so nothing else would report it.
    coordinator.registerSpawnTarget({
      pid: 212,
      agentId: 'claude',
      sessionId: 'session-212',
      materializationKey: 'session-212',
      connectedServicesBindingsRaw: { v: 1, bindingsByServiceId: { 'claude-subscription': { source: 'connected', profileId: 'personal' } } },
    });
    await expect(coordinator.describeLoginUse({ serviceId: 'claude-subscription', profileId: 'personal' }))
      .resolves.toEqual({ status: 'in_use', reason: 'terminal' });
  });

  it('lets a launch inside the distribution of a rotation hold the login without waiting for that distribution', async () => {
    const { coordinator, relay, onAuthUpdated, registerCodexTerminal } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    registerCodexTerminal(221, { mode: 'daemon_callback', serviceIds: ['openai-codex'] });
    // Applying the rotation restarts a session, whose launch holds the login it is about to start with.
    onAuthUpdated.mockImplementation(async () => {
      const release = await coordinator.holdNativeCredentialLaunch({ serviceId: 'openai-codex', profileId: 'work' });
      release?.();
      return { appliedRuntimeIdentityKeys: new Set<string>() };
    });

    const refreshed = coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    const settled = await Promise.race([
      refreshed.then(() => 'settled' as const),
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 2_000)),
    ]);
    expect(settled).toBe('settled');
    expect(onAuthUpdated).toHaveBeenCalled();
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'daemon-refresh' } });
  });

  it('holds a login from before a launch: an in-flight rotation finishes first, and none starts until release', async () => {
    const { coordinator, relay, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    let finishProviderRefresh: () => void = () => {};
    providerFetch.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishProviderRefresh = resolve; });
      return { ok: true, json: async () => ({ access_token: jwtExpiringAt(NOW + 3_600_000), refresh_token: 'refresh-1', id_token: 'new-id', expires_in: 3600 }) };
    });

    const inFlight = coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    await vi.waitFor(() => expect(providerFetch).toHaveBeenCalledTimes(1));
    let holdAcquired = false;
    const hold = coordinator.holdNativeCredentialLaunch({ serviceId: 'openai-codex', profileId: 'work' })
      .then((release) => { holdAcquired = true; return release; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(holdAcquired).toBe(false);
    finishProviderRefresh();
    await inFlight;
    const release = await hold;
    if (!release) throw new Error('expected the launch to hold a login its client rotates');
    expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-1' } });

    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toMatchObject({ record: null, heldByNativeClient: true });
    expect(providerFetch).toHaveBeenCalledTimes(1);

    release();
    await coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it('reads back as soon as a terminal or a run on the login exits', async () => {
    const { runtimeRegistry, relay, codexHome, registerCodexTerminal } = await setup(
      codexLogin('access-0', 'refresh-0', NOW + 3_600_000),
    );
    registerCodexTerminal(202);
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 7_200_000), 'refresh-1');
    runtimeRegistry.unregisterPid(202);
    await vi.waitFor(() => expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-1' } }));

    runtimeRegistry.registerRunTarget({
      runKey: 'run-1',
      pid: 303,
      agentId: 'codex',
      connectedServicesBindingsRaw: { v: 1, bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } } },
      connectedServiceSelectionsEnv: null,
      materializationKey: 'run-1',
      sessionDirectory: null,
      runtimeAccountIdentitySelections: [],
    });
    await rotateInCli(codexHome, jwtExpiringAt(NOW + 9_000_000), 'refresh-2');
    runtimeRegistry.unregisterRunKey('run-1');
    await vi.waitFor(() => expect(relay.state.record).toMatchObject({ oauth: { refreshToken: 'refresh-2' } }));
  });

  it('counts a terminal reattached after a daemon restart as the owner of its login', async () => {
    const { coordinator, runtimeRegistry, relay, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000));
    // A reattached session carries only what its marker kept: the bindings, no materialization details.
    registerConnectedServiceTrackedSessionTargetsForDaemon({
      runtimeRegistry,
      tracked: {
        pid: 505,
        startedBy: 'daemon',
        happySessionId: 'session-505',
        happySessionMetadataFromLocalWebhook: {
          path: '/tmp/session-505',
          host: 'test-host',
          homeDir: '/tmp/home',
          happyHomeDir: '/tmp/happier',
          happyLibDir: '/tmp/happier/lib',
          happyToolsDir: '/tmp/happier/tools',
          hostPid: 505,
          flavor: 'codex',
          connectedServices: {
            v: 1,
            bindingsByServiceId: { 'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' } },
          },
        },
      } as Parameters<typeof registerConnectedServiceTrackedSessionTargetsForDaemon>[0]['tracked'],
    });

    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toEqual({ record: null, reauthRequired: false, heldByNativeClient: true });
    expect(providerFetch).not.toHaveBeenCalled();
    expect(relay.state.writes).toBe(0);
  });

  it('refuses a login PiggerCode did not authorize until a new authorization replaces it', async () => {
    const { coordinator, relay, providerFetch } = await setup(codexLogin('access-0', 'refresh-0', NOW + 30_000, 'unmarked'));
    await expect(coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true }))
      .resolves.toMatchObject({ record: null, reauthRequired: true });
    expect(providerFetch).not.toHaveBeenCalled();

    // The owner signs in again (`connect codex --device`), which stores a freshly authorized login.
    relay.state.record = codexLogin('access-new', 'refresh-new', NOW + 30_000);
    relay.state.revision = 'csr_0000000000000000000009';
    const result = await coordinator.refreshConnectedServiceCredentialForQuota({ serviceId: 'openai-codex', profileId: 'work', force: true });
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(result.record).toMatchObject({ oauth: { refreshToken: 'daemon-refresh', raw: { credentialOrigin: 'fresh_authorization' } } });
  });
});

import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';

const run = createRunDirs({ runLabel: 'ui-e2e' });

test.describe('ui e2e: mTLS auto-redirect', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('auth-mtls-auto-redirect-suite');

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let proxyBaseUrl: string | null = null;
  let proxyStop: (() => Promise<void>) | null = null;

  function resolveServerLightSqliteDbPath(params: { server: StartedServer }): string {
    return resolve(join(params.server.dataDir, 'happier-server-light.sqlite'));
  }

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    await mkdir(suiteDir, { recursive: true });

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        PIGGERCODE_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
        AUTH_ANONYMOUS_SIGNUP_ENABLED: '0',
        AUTH_SIGNUP_PROVIDERS: '',

        PIGGERCODE_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
        PIGGERCODE_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        PIGGERCODE_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',

        PIGGERCODE_FEATURE_AUTH_MTLS__ENABLED: '1',
        PIGGERCODE_FEATURE_AUTH_MTLS__MODE: 'forwarded',
        PIGGERCODE_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
        PIGGERCODE_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
        PIGGERCODE_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
        PIGGERCODE_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
        PIGGERCODE_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: 'CN=Example Root CA',
        PIGGERCODE_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
        PIGGERCODE_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
        PIGGERCODE_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',

        PIGGERCODE_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
        PIGGERCODE_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
      },
    });

    const proxy = await startForwardedHeaderProxy({
      targetBaseUrl: server.baseUrl,
      identityHeaders: {
        'x-happier-client-cert-email': 'alice@example.com',
        'x-happier-client-cert-issuer': 'CN=Example Root CA',
        'x-happier-client-cert-sha256': 'sha256:abc123',
      },
    });
    proxyBaseUrl = proxy.baseUrl;
    proxyStop = proxy.stop;

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
        PIGGERCODE_E2E_UI_WEB_MODE: 'export',
      },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop().catch(() => {});
    await proxyStop?.().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('auto-redirects and logs in via forwarded mTLS', async ({ page }) => {
    test.setTimeout(180_000);
    if (!uiBaseUrl) throw new Error('missing ui base url');
    if (!server) throw new Error('missing server');
    if (!proxyBaseUrl) throw new Error('missing proxy base url');

    const mtlsOk = page.waitForResponse(
      (resp) => resp.url().startsWith(`${proxyBaseUrl}/v1/auth/mtls`) && resp.status() === 200,
      { timeout: 120_000 },
    );

    await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
    await waitForInitialAppUi({ page, timeoutMs: 120_000 });
    await mtlsOk;

    await expect(page.getByTestId('welcome-create-account')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('session-getting-started-kind-connect_machine')).toHaveCount(1, { timeout: 120_000 });
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 120_000 }).toBe('/');

    const dbPath = resolveServerLightSqliteDbPath({ server });
    const raw = execFileSync(
      'sqlite3',
      ['-json', dbPath, "select count(1) as n from AccountIdentity where provider = 'mtls';"],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(raw) as Array<{ n?: unknown }>;
    const n = parsed?.[0]?.n;
    expect(n === 1 || n === '1').toBe(true);
  });
});

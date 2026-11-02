import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuthMtls } from '../../src/testkit/auth';
import { upsertPlainAccountSettingsV2 } from '../../src/testkit/accountSettings';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { startCliAuthLoginForTerminalConnect } from '../../src/testkit/uiE2e/cliTerminalConnect';
import { acknowledgeTerminalConnectSuccessIfPresent } from '../../src/testkit/uiE2e/acknowledgeTerminalConnectSuccessIfPresent';
import { waitForDaemonMachineIdFromCliSettings } from '../../src/testkit/uiE2e/daemonMachineId';
import { fakeClaudeFixturePath } from '../../src/testkit/fakeClaude';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { startForwardedHeaderProxy } from '../../src/testkit/uiE2e/forwardedHeaderProxy';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { collectBrowserDiagnostics, appendBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import { createPlainSession, resolveCanonicalServerIdForUi } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { withTimeoutMs } from '../../src/testkit/timing/withTimeout';

const run = createRunDirs({ runLabel: 'ui-e2e-session-explorer' });

const IDENTITY = {
  email: `session-explorer-${run.runId}@example.com`,
  issuer: 'happier-ui-e2e-session-explorer',
  fingerprint: `session-explorer-${run.runId}`,
} as const;

async function stopBestEffort(label: string, stop: (() => Promise<void>) | null | undefined): Promise<void> {
  if (!stop) return;
  await withTimeoutMs({ promise: stop(), timeoutMs: 90_000, label }).catch(() => {});
}

test.describe('ui e2e: session list folder explorer', () => {
  test.describe.configure({ mode: 'serial' });

  const suiteDir = run.testDir('session-explorer-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
  // The daemon's home folder: what the explorer shows as `~`.
  const machineHome = resolve(join(suiteDir, 'machine-home'));
  const screenshotDir = resolve(join(suiteDir, 'screenshots'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let proxyBaseUrl: string | null = null;
  let proxyStop: (() => Promise<void>) | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    const uiWebEnv = {
      ...process.env,
      EXPO_PUBLIC_DEBUG: '1',
      EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
      HAPPIER_E2E_UI_WEB_MODE: 'export',
      HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      HAPPIER_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
      HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.HAPPIER_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await mkdir(screenshotDir, { recursive: true });
    for (const folder of ['code/happier/apps', 'code/grad', 'Downloads', '.config/tool']) {
      await mkdir(join(machineHome, folder), { recursive: true });
    }
    await writeFile(join(machineHome, 'notes.txt'), 'files are not folders\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '0',
        AUTH_ANONYMOUS_SIGNUP_ENABLED: '0',
        AUTH_SIGNUP_PROVIDERS: '',
        HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
        HAPPIER_FEATURE_AUTH_MTLS__ENABLED: '1',
        HAPPIER_FEATURE_AUTH_MTLS__MODE: 'forwarded',
        HAPPIER_FEATURE_AUTH_MTLS__TRUST_FORWARDED_HEADERS: '1',
        HAPPIER_FEATURE_AUTH_MTLS__AUTO_PROVISION: '1',
        HAPPIER_FEATURE_AUTH_MTLS__IDENTITY_SOURCE: 'san_email',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_EMAIL_DOMAINS: 'example.com',
        HAPPIER_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: IDENTITY.issuer,
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_EMAIL_HEADER: 'x-happier-client-cert-email',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_ISSUER_HEADER: 'x-happier-client-cert-issuer',
        HAPPIER_FEATURE_AUTH_MTLS__FORWARDED_FINGERPRINT_HEADER: 'x-happier-client-cert-sha256',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_ENABLED: '1',
        HAPPIER_FEATURE_AUTH_UI__AUTO_REDIRECT_PROVIDER_ID: 'mtls',
      },
    });

    const proxy = await startForwardedHeaderProxy({
      targetBaseUrl: server.baseUrl,
      identityHeaders: {
        'x-happier-client-cert-email': IDENTITY.email,
        'x-happier-client-cert-issuer': IDENTITY.issuer,
        'x-happier-client-cert-sha256': IDENTITY.fingerprint,
      },
    });
    proxyBaseUrl = proxy.baseUrl;
    proxyStop = proxy.stop;

    ui = await startUiWeb({
      testDir: suiteDir,
      env: { ...uiWebEnv, EXPO_PUBLIC_HAPPY_SERVER_URL: proxy.baseUrl },
    });
    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    await Promise.allSettled([
      stopBestEffort('session explorer daemon stop', daemon?.stop),
      stopBestEffort('session explorer UI web stop', ui?.stop),
      stopBestEffort('session explorer proxy stop', proxyStop),
      stopBestEffort('session explorer server stop', server?.stop),
    ]);
  });

  async function connectDaemon(page: Page): Promise<string> {
    if (!server || !uiBaseUrl || !proxyBaseUrl) throw new Error('missing fixtures');
    await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
    await waitForInitialAppUi({ page, timeoutMs: 180_000 });
    await expect.poll(async () => await page.getByTestId('session-getting-started-kind-connect_machine').count(), { timeout: 180_000 }).toBeGreaterThan(0);

    const testDir = resolve(join(suiteDir, 'connect'));
    await mkdir(testDir, { recursive: true });
    const cliLogin = await startCliAuthLoginForTerminalConnect({
      testDir,
      cliHomeDir,
      serverUrl: proxyBaseUrl,
      webappUrl: uiBaseUrl,
      env: {
        ...process.env,
        CI: '1',
        HAPPIER_DISABLE_CAFFEINATE: '1',
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        HAPPIER_VARIANT: 'dev',
      },
    });
    await gotoDomContentLoadedWithRetries(page, cliLogin.connectUrl, 90_000);
    await expect(page.getByTestId('terminal-connect-approve')).toHaveCount(1, { timeout: 60_000 });
    await page.getByTestId('terminal-connect-approve').click();
    await cliLogin.waitForSuccess();
    await acknowledgeTerminalConnectSuccessIfPresent(page);

    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: cliHomeDir,
      env: {
        ...process.env,
        CI: '1',
        HOME: machineHome,
        HAPPIER_HOME_DIR: cliHomeDir,
        HAPPIER_SERVER_URL: proxyBaseUrl,
        HAPPIER_WEBAPP_URL: uiBaseUrl,
        HAPPIER_DISABLE_CAFFEINATE: '1',
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        HAPPIER_VARIANT: 'dev',
        HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
        HAPPIER_E2E_FAKE_CLAUDE_LOG: resolve(join(testDir, 'fake-claude.jsonl')),
      },
    });
    return await waitForDaemonMachineIdFromCliSettings({ cliHomeDir, timeoutMs: 120_000 });
  }

  test('shows the machine folders with each session in the folder it started in, per agent', async ({ page }) => {
    test.setTimeout(900_000);
    if (!server || !uiBaseUrl || !proxyBaseUrl) throw new Error('missing fixtures');
    const diagnostics = collectBrowserDiagnostics({ page });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const machineId = await connectDaemon(page);
      const serverId = await resolveCanonicalServerIdForUi(proxyBaseUrl);
      const { token } = await createTestAuthMtls(server.baseUrl, IDENTITY);
      // Saved list settings, like an account set up before the explorer existed, must not hide it.
      await upsertPlainAccountSettingsV2({
        baseUrl: server.baseUrl,
        token,
        settings: { sessionListActiveGroupingV1: 'project', sessionListInactiveGroupingV1: 'date' },
      });

      const seed = async (title: string, folder: string, flavor: string) => await createPlainSession({
        baseUrl: server!.baseUrl,
        token,
        title,
        rootPath: folder ? join(machineHome, folder) : machineHome,
        homeDir: machineHome,
        machineId,
        tagPrefix: 'session-explorer',
        flavor,
      });
      const scratchSession = await seed('Scratch notes', '', 'claude');
      const gradSession = await seed('Grade the essays', 'code/grad', 'codex');
      const greetingSession = await seed('Respond to greeting', '', 'claude');
      const sidebarSession = await seed('Fix the sidebar layout', 'code/happier', 'claude');

      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
      await waitForInitialAppUi({ page, timeoutMs: 180_000 });

      const folder = (path: string) => page.getByTestId(`session-list-header:explorer:${serverId}:${machineId}:${path}`);
      const home = folder(machineHome);
      const code = folder(join(machineHome, 'code'));
      const happier = folder(join(machineHome, 'code/happier'));
      const downloads = folder(join(machineHome, 'Downloads'));
      const hiddenConfig = folder(join(machineHome, '.config'));

      // The most recently updated session runs Claude, so the picker starts there.
      await expect(page.getByTestId('session-list-agent-picker')).toHaveCount(1, { timeout: 180_000 });
      await expect(page.getByTestId(`session-list-item-${sidebarSession}`)).toHaveCount(1, { timeout: 180_000 });
      await expect(page.getByTestId(`session-list-item-${greetingSession}`)).toHaveCount(1);
      await expect(page.getByTestId(`session-list-item-${gradSession}`)).toHaveCount(0);

      // Folders with sessions open; the machine's other folders come from the live listing, closed.
      await expect(home).toHaveAttribute('aria-expanded', 'true');
      await expect(code).toHaveAttribute('aria-expanded', 'true');
      await expect(happier).toHaveAttribute('aria-expanded', 'true');
      await expect(downloads).toHaveAttribute('aria-expanded', 'false', { timeout: 60_000 });
      await expect(folder(join(machineHome, 'code/happier/apps'))).toHaveCount(1, { timeout: 60_000 });
      await expect(hiddenConfig).toHaveCount(0);
      await expect(folder(join(machineHome, 'notes.txt'))).toHaveCount(0);
      await page.screenshot({ path: join(screenshotDir, '1-explorer-claude.png') });

      // Opening an empty folder lists it and says so.
      await downloads.click();
      await expect(downloads).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId(`session-list-header:explorer:${serverId}:${machineId}:${join(machineHome, 'Downloads')}#status`)).toHaveCount(1, { timeout: 60_000 });

      // Hidden folders show on request.
      await page.getByTestId('session-explorer-menu-trigger').click();
      await page.getByTestId('session-explorer-show-hidden').click();
      await expect(hiddenConfig).toHaveCount(1, { timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '2-explorer-opened.png') });

      // The picker switches the list to another agent's sessions.
      await page.getByTestId('session-list-agent-picker').click();
      await page.screenshot({ path: join(screenshotDir, '3-agent-picker-open.png') });
      await page.getByTestId('session-list-agent-picker:codex').click();
      await expect(page.getByTestId(`session-list-item-${gradSession}`)).toHaveCount(1, { timeout: 60_000 });
      await expect(page.getByTestId(`session-list-item-${sidebarSession}`)).toHaveCount(0);
      await page.screenshot({ path: join(screenshotDir, '4-explorer-codex.png') });

      // + on a folder starts a session there with the picked agent.
      const grad = `session-list-header:explorer:${serverId}:${machineId}:${join(machineHome, 'code/grad')}`;
      await page.getByTestId(grad).hover();
      await page.getByTestId(`${grad}:new-session`).click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toBe('/new');
      const params = new URL(page.url()).searchParams;
      expect(params.get('agentType')).toBe('codex');
      expect(params.get('directory')).toBe(join(machineHome, 'code/grad'));
      expect(params.get('machineId')).toBe(machineId);

      // A stopped session is deleted from its row menu after the destructive confirmation.
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
      await waitForInitialAppUi({ page, timeoutMs: 180_000 });
      await page.getByTestId('session-list-agent-picker').click();
      await page.getByTestId('session-list-agent-picker:claude').click();
      const scratchRow = page.getByTestId(`session-list-item-${scratchSession}`);
      await expect(scratchRow).toHaveCount(1, { timeout: 120_000 });
      await scratchRow.hover();
      await scratchRow.getByTestId('session-item-more-menu').click();
      const deleteOption = page.getByTestId('dropdown-option-ui_session_delete');
      await expect(deleteOption).toBeEnabled({ timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '5-row-menu-delete.png') });
      await deleteOption.click();
      await page.getByTestId('web-modal-confirm').click();
      await expect(scratchRow).toHaveCount(0, { timeout: 60_000 });
      await expect(page.getByTestId(`session-list-item-${greetingSession}`)).toHaveCount(1);

      // Open Folder: with ~/code opened, the tree starts there and the rest waits under Other locations.
      await upsertPlainAccountSettingsV2({
        baseUrl: server.baseUrl,
        token,
        settings: { sessionListExplorerRootsV1: { [`explorer:${serverId}:${machineId}`]: join(machineHome, 'code') } },
      });
      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
      await waitForInitialAppUi({ page, timeoutMs: 180_000 });
      await expect(code).toHaveCount(1, { timeout: 120_000 });
      await expect(code).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId(`session-list-item-${sidebarSession}`)).toHaveCount(1, { timeout: 60_000 });
      const other = page.getByTestId(`session-list-header:explorer:${serverId}:${machineId}:other`);
      await expect(other).toHaveAttribute('aria-expanded', 'false');
      await expect(home).toHaveCount(0);
      await expect(page.getByTestId(`session-list-item-${greetingSession}`)).toHaveCount(0);
      await page.screenshot({ path: join(screenshotDir, '6-opened-folder.png') });
      await other.click();
      await expect(home).toHaveCount(1, { timeout: 60_000 });
      await expect(page.getByTestId(`session-list-item-${greetingSession}`)).toHaveCount(1);
      await page.screenshot({ path: join(screenshotDir, '7-other-locations.png') });
    } catch (error) {
      throw appendBrowserDiagnostics(error, diagnostics());
    }
  });
});

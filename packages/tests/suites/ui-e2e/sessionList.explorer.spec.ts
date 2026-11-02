import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
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
      PIGGERCODE_E2E_UI_WEB_MODE: 'export',
      PIGGERCODE_E2E_UI_WEB_EXPORT_TIMEOUT_MS: process.env.PIGGERCODE_E2E_UI_WEB_EXPORT_TIMEOUT_MS ?? '900000',
      PIGGERCODE_E2E_UI_WEB_EXPORT_FALLBACK_TO_METRO: '0',
      PIGGERCODE_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS: process.env.PIGGERCODE_E2E_UI_WEB_SCRIPT_FETCH_TIMEOUT_MS ?? '480000',
    };
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(uiWebEnv));
    await mkdir(cliHomeDir, { recursive: true });
    await mkdir(screenshotDir, { recursive: true });
    for (const folder of ['code/happier/apps', 'code/grad', 'Downloads', '.config/tool']) {
      await mkdir(join(machineHome, folder), { recursive: true });
    }
    await writeFile(join(machineHome, 'notes.txt'), 'files are not folders\n', 'utf8');
    await writeFile(join(machineHome, 'code', 'happier', 'README.md'), '# Hello from the Files view\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        PIGGERCODE_BUILD_FEATURES_DENY: 'sharing.contentKeys',
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
        PIGGERCODE_FEATURE_AUTH_MTLS__ALLOWED_ISSUERS: IDENTITY.issuer,
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
        PIGGERCODE_DISABLE_CAFFEINATE: '1',
        PIGGERCODE_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        PIGGERCODE_VARIANT: 'dev',
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
        PIGGERCODE_HOME_DIR: cliHomeDir,
        PIGGERCODE_SERVER_URL: proxyBaseUrl,
        PIGGERCODE_WEBAPP_URL: uiBaseUrl,
        PIGGERCODE_DISABLE_CAFFEINATE: '1',
        PIGGERCODE_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
        PIGGERCODE_VARIANT: 'dev',
        PIGGERCODE_CLAUDE_PATH: fakeClaudeFixturePath(),
        PIGGERCODE_E2E_FAKE_CLAUDE_LOG: resolve(join(testDir, 'fake-claude.jsonl')),
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

      // A folder's ⋯ menu starts sessions and makes folders; the top folder cannot be renamed or deleted.
      const codeTestId = `session-list-header:explorer:${serverId}:${machineId}:${join(machineHome, 'code')}`;
      await page.getByTestId(`${codeTestId}:menu`).click();
      await expect(page.getByTestId('session-explorer-folder-new-folder')).toHaveCount(1, { timeout: 60_000 });
      await expect(page.locator('[data-testid^="session-explorer-folder-new-session"]').first()).toBeVisible();
      await expect(page.getByTestId('session-explorer-folder-copy-path')).toHaveCount(1);
      await expect(page.getByTestId('session-explorer-folder-rename')).toHaveCount(0);
      await expect(page.getByTestId('session-explorer-folder-delete')).toHaveCount(0);
      await page.screenshot({ path: join(screenshotDir, '8-folder-menu.png') });
      await page.getByTestId('session-explorer-folder-new-folder').click();
      await page.getByTestId('web-prompt-input').fill('scratch-dir');
      await page.getByTestId('web-prompt-confirm').click();
      const scratchDirPath = join(machineHome, 'code', 'scratch-dir');
      const scratchDir = folder(scratchDirPath);
      await expect(scratchDir).toHaveCount(1, { timeout: 60_000 });
      await expect.poll(() => existsSync(scratchDirPath), { timeout: 30_000 }).toBe(true);
      await page.screenshot({ path: join(screenshotDir, '9-folder-created.png') });

      // A right-click opens the same menu: rename the new folder in place on the machine.
      await scratchDir.click({ button: 'right' });
      await expect(page.getByTestId('session-explorer-folder-rename')).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '10-folder-right-click.png') });
      await page.getByTestId('session-explorer-folder-rename').click();
      await expect(page.getByTestId('web-prompt-input')).toHaveValue('scratch-dir');
      await page.getByTestId('web-prompt-input').fill('scratch-renamed');
      await page.getByTestId('web-prompt-confirm').click();
      const renamedPath = join(machineHome, 'code', 'scratch-renamed');
      const renamed = folder(renamedPath);
      await expect(renamed).toHaveCount(1, { timeout: 60_000 });
      await expect(scratchDir).toHaveCount(0);
      await expect.poll(() => existsSync(renamedPath) && !existsSync(scratchDirPath), { timeout: 30_000 }).toBe(true);

      // Deleting it asks first, then removes it from the machine and the tree.
      await renamed.click({ button: 'right' });
      await page.getByTestId('session-explorer-folder-delete').click();
      await page.getByTestId('web-modal-confirm').click();
      await expect(renamed).toHaveCount(0, { timeout: 60_000 });
      await expect.poll(() => existsSync(renamedPath), { timeout: 30_000 }).toBe(false);
      await expect(happier).toHaveCount(1);

      // A right-click on a session opens its ⋯ menu.
      await page.getByTestId(`session-list-item-${sidebarSession}`).click({ button: 'right' });
      await expect(page.getByTestId('dropdown-option-ui_session_rename')).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '11-session-right-click.png') });
      await page.keyboard.press('Escape');

      // The Files view turns the explorer into a file manager: folders and files, no sessions.
      await page.getByTestId('session-explorer-mode:files').click();
      await expect(page.getByTestId(`session-list-item-${sidebarSession}`)).toHaveCount(0, { timeout: 60_000 });
      await expect(page.getByTestId('session-list-agent-picker')).toHaveCount(0);
      await expect(happier).toHaveCount(1, { timeout: 60_000 });
      if ((await happier.getAttribute('aria-expanded')) !== 'true') await happier.click();
      const readmePath = join(machineHome, 'code', 'happier', 'README.md');
      const readme = page.getByTestId(`session-list-header:explorer:${serverId}:${machineId}:${join(machineHome, 'code/happier')}#file:README.md`);
      await expect(readme).toHaveCount(1, { timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '12-files-view.png') });

      // A file opens in a read-only preview beside the tree.
      await readme.click();
      await expect(page.getByTestId('machine-file-preview-code')).toContainText('Hello from the Files view', { timeout: 60_000 });
      await page.screenshot({ path: join(screenshotDir, '13-file-preview.png') });

      // Its right-click menu downloads it and deletes it on the machine.
      await readme.click({ button: 'right' });
      const download = page.waitForEvent('download');
      await page.getByTestId('session-explorer-file-download').click();
      expect((await download).suggestedFilename()).toBe('README.md');
      await readme.click({ button: 'right' });
      await page.getByTestId('session-explorer-file-delete').click();
      await page.getByTestId('web-modal-confirm').click();
      await expect(readme).toHaveCount(0, { timeout: 60_000 });
      await expect.poll(() => existsSync(readmePath), { timeout: 30_000 }).toBe(false);

      // Back in the Sessions view the sessions return.
      await page.getByTestId('session-explorer-mode:sessions').click();
      await expect(page.getByTestId(`session-list-item-${sidebarSession}`)).toHaveCount(1, { timeout: 60_000 });
    } catch (error) {
      throw appendBrowserDiagnostics(error, diagnostics());
    }
  });
});

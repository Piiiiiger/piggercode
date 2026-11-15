import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { createTestAuthMtls } from '../../src/testkit/auth';
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
import { createPlainSession } from '../../src/testkit/uiE2e/sessionFoldersDrag';
import { withTimeoutMs } from '../../src/testkit/timing/withTimeout';

const run = createRunDirs({ runLabel: 'ui-e2e-session-recent-box' });

const IDENTITY = {
  email: `session-recent-box-${run.runId}@example.com`,
  issuer: 'happier-ui-e2e-session-recent-box',
  fingerprint: `session-recent-box-${run.runId}`,
} as const;

async function stopBestEffort(label: string, stop: (() => Promise<void>) | null | undefined): Promise<void> {
  if (!stop) return;
  await withTimeoutMs({ promise: stop(), timeoutMs: 90_000, label }).catch(() => {});
}

test.describe('ui e2e: the 「最近」 box', () => {
  test.describe.configure({ mode: 'serial' });
  // The owner's language: rows read 「已完成」.
  test.use({ locale: 'zh-CN' });

  const suiteDir = run.testDir('session-recent-box-suite');
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
      stopBestEffort('recent box daemon stop', daemon?.stop),
      stopBestEffort('recent box UI web stop', ui?.stop),
      stopBestEffort('recent box proxy stop', proxyStop),
      stopBestEffort('recent box server stop', server?.stop),
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

  test('puts a finished turn the user has not opened first, in words, and lets seen ones go first', async ({ page }) => {
    test.setTimeout(900_000);
    if (!server || !uiBaseUrl || !proxyBaseUrl) throw new Error('missing fixtures');
    const diagnostics = collectBrowserDiagnostics({ page });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const machineId = await connectDaemon(page);
      const { token } = await createTestAuthMtls(server.baseUrl, IDENTITY);
      const api = async (path: string, body: unknown) => {
        const res = await fetch(`${server!.baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
      };
      const seed = async (title: string) => await createPlainSession({
        baseUrl: server!.baseUrl,
        token,
        title,
        rootPath: join(machineHome, 'code/happier'),
        homeDir: machineHome,
        machineId,
        tagPrefix: 'recent-box',
      });
      // A turn ends the way a terminal session's runner reports it: the session's ready event.
      const finishTurn = async (sessionId: string) => await api(`/v2/sessions/${sessionId}/messages`, {
        localId: `ready-${randomUUID()}`,
        sessionEventType: 'ready',
        content: { t: 'plain', v: { role: 'agent', content: { type: 'event', id: randomUUID(), data: { type: 'ready' } } } },
      });
      const markSeen = async (sessionId: string) => await api(`/v2/sessions/${sessionId}/read-state`, { state: 'read' });
      const pause = async () => await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));

      // Finished first and never opened.
      const unopened = await seed('检查服务器日志');
      await finishTurn(unopened);
      // Five newer ones, finished and already looked at.
      const seen: string[] = [];
      for (const title of ['整理发布说明', '修复侧边栏布局', '更新依赖', '回答问候', '写测试']) {
        await pause();
        const id = await seed(title);
        await finishTurn(id);
        await markSeen(id);
        seen.push(id);
      }

      await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/?happier_hmr=0`, 300_000);
      await waitForInitialAppUi({ page, timeoutMs: 180_000 });
      const box = page.getByTestId('session-list-recent-box');
      await expect(box).toHaveCount(1, { timeout: 180_000 });

      // The unopened one is in the box, first, and says it in words; the oldest seen one gave way.
      await expect(box.getByTestId(`session-list-item-${unopened}`)).toHaveCount(1, { timeout: 120_000 });
      const label = box.getByTestId(`session-row-attention-indicator-label-${unopened}-trailing:label`);
      await expect(label).toHaveText('已完成', { timeout: 60_000 });
      await expect(box.getByTestId(`session-list-item-${seen[0]}`)).toHaveCount(0);
      const order = await box.locator('[data-testid^="session-list-item-"]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-testid')));
      expect(order[0]).toBe(`session-list-item-${unopened}`);
      await page.screenshot({ path: join(screenshotDir, 'recent-1-unopened-first.png') });
      await page.screenshot({ path: join(screenshotDir, 'recent-1-sidebar.png'), clip: { x: 0, y: 0, width: 420, height: 520 } });

      // Opening it is looking at it: done and seen, it becomes the oldest seen one and leaves the box.
      await box.getByTestId(`session-list-item-${unopened}`).click();
      await expect(page.getByTestId('session-list-recent-box').getByTestId(`session-list-item-${unopened}`)).toHaveCount(0, { timeout: 120_000 });
      await expect(page.getByTestId('session-list-recent-box').getByTestId(`session-list-item-${seen[0]}`)).toHaveCount(1);
      await page.screenshot({ path: join(screenshotDir, 'recent-2-after-opening.png') });
      await page.screenshot({ path: join(screenshotDir, 'recent-2-sidebar.png'), clip: { x: 0, y: 0, width: 420, height: 520 } });
    } catch (error) {
      throw appendBrowserDiagnostics(error, diagnostics());
    }
  });
});

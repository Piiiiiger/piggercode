import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { createRunDirs } from '../../src/testkit/runDir';
import {
  createDesktopPetOverlayWindowState,
  installDesktopPetOverlayBridgeProbe,
} from '../../src/testkit/pets/desktopPetOverlayBridgeProbe';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { setSingleAccountPetsEnabled, setSingleAccountUiFeatureToggle } from '../../src/testkit/pets/uiPetsFeatureToggle';
import {
  createCodexFixturePet,
  expectPetSpriteImageLoaded,
  useCodexFixturePetOnThisDevice,
} from '../../src/testkit/pets/codexFixturePet';

const run = createRunDirs({ runLabel: 'ui-e2e' });

/**
 * The desktop overlay's bubble marks, rendered by the real overlay route in a browser: a running turn spins,
 * a finished turn nobody has opened shows its check and the 「待查阅」 pill beside the latest message.
 */
test.describe('ui e2e: pets desktop overlay tray status marks', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ locale: 'zh-CN' });

  const suiteDir = run.testDir('pets-overlay-tray-status-marks-suite');
  const screenshotDir = resolve(join(suiteDir, 'screenshots'));
  const sessionId = 'pets-overlay-tray-status-e2e';

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let daemon: StartedDaemon | null = null;
  let uiBaseUrl: string | null = null;

  test.beforeAll(async () => {
    test.setTimeout(900_000);
    await mkdir(screenshotDir, { recursive: true });

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        PIGGERCODE_BUILD_FEATURES_DENY: 'sharing.contentKeys,providers.claude.unifiedTerminal',
        PIGGERCODE_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-pets-overlay-tray-marks-${run.runId}`,
        PIGGERCODE_E2E_UI_WEB_MODE: 'export',
      },
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterEach(async () => {
    await daemon?.stop().catch(() => {});
    daemon = null;
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  /**
   * The tray sits beside the pet and shows only with it, and no built-in pet exists: each test (a fresh browser
   * context, so a fresh account, which the daemon login creates) takes the fixture pet from its own daemon.
   */
  async function openOverlay(
    page: Page,
    testName: string,
    windowState: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!server || !uiBaseUrl) throw new Error('missing fixtures');
    await page.setViewportSize({ width: 1440, height: 900 });
    const testDir = resolve(join(suiteDir, testName));
    const cliHomeDir = resolve(join(testDir, 'cli-home'));
    const codexHomeDir = resolve(join(testDir, 'codex-home'));
    await mkdir(cliHomeDir, { recursive: true });
    await createCodexFixturePet(codexHomeDir);
    daemon = await authenticateAndStartDaemon({
      page,
      testDir,
      cliHomeDir,
      serverUrl: server.baseUrl,
      uiBaseUrl,
      extraEnv: { CODEX_HOME: codexHomeDir },
    });
    await setSingleAccountUiFeatureToggle({ page, baseUrl: uiBaseUrl, featureId: 'pets.companion', enabled: true });
    await setSingleAccountPetsEnabled({ page, baseUrl: uiBaseUrl, enabled: true });
    await useCodexFixturePetOnThisDevice({ page, uiBaseUrl });

    await installDesktopPetOverlayBridgeProbe(page, { windowState });
    await gotoDomContentLoadedWithRetries(
      page,
      `${uiBaseUrl}/desktop/pet-overlay?happier_hmr=0&desktopPetOverlayWindow=1`,
      180_000,
    );
    await expect(page.getByTestId('desktop-pet-overlay-tray')).toHaveCount(1, { timeout: 120_000 });
    // The screenshots show the pet beside its bubble, not the blank surface it has while its image arrives.
    await expectPetSpriteImageLoaded(page.getByTestId('desktop-pet-overlay-sprite'));
  }

  test('a running turn spins in the bubble corner', async ({ page }) => {
    test.setTimeout(420_000);
    await openOverlay(page, 'running', createDesktopPetOverlayWindowState({
      sessionId,
      title: '沪日专线mk后置土耳其节点',
      status: 'running',
    }));

    const spinner = page.getByTestId(`desktop-pet-overlay-tray-spinner-${sessionId}`);
    await expect(spinner).toBeVisible({ timeout: 60_000 });
    // It turns: a running animation on the spinner whose clock advances (a held spinner has none, and a declared
    // animation-name without its keyframes creates none). Read before the screenshot, which cancels CSS animations.
    const spinnerClock = () => spinner.evaluate((root) => {
      const running = [root, ...Array.from(root.querySelectorAll('*'))]
        .flatMap((node) => node.getAnimations())
        .find((animation) => animation.playState === 'running');
      return running ? Number(running.currentTime ?? 0) : null;
    });
    await expect.poll(spinnerClock, { timeout: 30_000 }).not.toBeNull();
    const firstTick = await spinnerClock();
    await expect.poll(spinnerClock, { timeout: 10_000 }).not.toBe(firstTick);
    await expect(page.getByTestId(`desktop-pet-overlay-tray-status-glyph-${sessionId}`)).toHaveCount(0);
    await expect(page.getByTestId(`desktop-pet-overlay-tray-review-label-${sessionId}`)).toHaveCount(0);
    await page.getByTestId('desktop-pet-overlay-root').screenshot({ path: join(screenshotDir, 'tray-1-running.png') });
  });

  test('a finished turn nobody has opened shows its check and the review pill', async ({ page }) => {
    test.setTimeout(420_000);
    await openOverlay(page, 'review', createDesktopPetOverlayWindowState({
      sessionId,
      title: '沪日专线mk后置土耳其节点',
      status: 'review',
      subtitle: '土耳其节点已经挂到 MK 后置，三个前置都测通了。',
    }));

    await expect(page.getByTestId(`desktop-pet-overlay-tray-review-label-${sessionId}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`desktop-pet-overlay-tray-status-glyph-${sessionId}`)).toBeVisible();
    await expect(page.getByTestId(`desktop-pet-overlay-tray-spinner-${sessionId}`)).toHaveCount(0);
    await expect(page.getByTestId(`desktop-pet-overlay-tray-subtitle-${sessionId}`)).toBeVisible();
    await page.getByTestId('desktop-pet-overlay-root').screenshot({ path: join(screenshotDir, 'tray-2-review.png') });
  });
});

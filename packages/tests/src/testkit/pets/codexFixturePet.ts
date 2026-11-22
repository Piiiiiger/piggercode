import { expect, type Locator, type Page } from '@playwright/test';
import { join, resolve } from 'node:path';

import { gotoDomContentLoadedWithRetries } from '../uiE2e/pageNavigation';
import { createMinimalCodexPetPackage } from './petPackageFixture';
import {
  detectedPetTileByDisplayName,
  localLibraryPetTileByDisplayName,
  tileSubnodeByTestIdPrefix,
} from './petsSettingsSelectors';

/**
 * A pet for e2e surfaces that should show one.
 *
 * PiggerCode ships no built-in pets (app 0.3.54), so a pet surface shows only a pet this device took from a daemon.
 * Create the fixture in a Codex home, start the daemon with `CODEX_HOME: <codexHomeDir>`, then adopt the pet the way a
 * person does with `useCodexFixturePetOnThisDevice`. The fixture atlas draws a visible marker in every used cell.
 */
export const codexFixturePetDisplayName = 'Pig E2E Fixture';

export async function createCodexFixturePet(codexHomeDir: string): Promise<void> {
  await createMinimalCodexPetPackage({
    rootDir: resolve(join(codexHomeDir, 'pets')),
    petId: 'pig-e2e-fixture',
    displayName: codexFixturePetDisplayName,
  });
}

/**
 * Settings → Pets → Detect Codex pets → Use on this device, which imports the fixture into the daemon's library and
 * selects it for this device. Needs the `pets.companion` feature on and a daemon started with the fixture's Codex home.
 * Run it before installing the desktop overlay bridge probe, so Settings opens as the plain web app.
 */
export async function useCodexFixturePetOnThisDevice(params: Readonly<{
  page: Page;
  uiBaseUrl: string;
}>): Promise<void> {
  const { page } = params;
  await gotoDomContentLoadedWithRetries(page, `${params.uiBaseUrl}/settings/pets?happier_hmr=0`, 180_000);
  const detect = page.getByTestId('settings-pets-detect-codex-pets');
  await expect(detect).toHaveCount(1, { timeout: 120_000 });

  const detectedPetTile = detectedPetTileByDisplayName({ page, displayName: codexFixturePetDisplayName });
  // The daemon may still be registering its machine when Settings opens; detection then has no machine to ask
  // (`settings-pets-detected-codex-pets-no-target`). Ask again, slower than the daemon's discover limit, until the
  // fixture shows up.
  await expect.poll(async () => {
    if (await detectedPetTile.count() > 0) return true;
    await detect.click();
    return false;
  }, { timeout: 120_000, intervals: [1_000, 2_000, 5_000] }).toBe(true);
  const useOnThisDevice = tileSubnodeByTestIdPrefix({
    tile: detectedPetTile,
    prefix: 'settings-pets-use-on-this-device-',
  });
  await expect(useOnThisDevice).toHaveCount(1, { timeout: 120_000 });
  await useOnThisDevice.click();

  const localLibrary = page.getByTestId('settings-pets-local-library-list');
  await expect(localLibraryPetTileByDisplayName({
    page,
    localLibrary,
    displayName: codexFixturePetDisplayName,
  })).toHaveCount(1, { timeout: 120_000 });
}

/**
 * Waits until a pet sprite draws its spritesheet. The image comes from the daemon after the surface mounts (the surface
 * is blank meanwhile), so pixel checks of a pet wait for this first.
 */
export async function expectPetSpriteImageLoaded(sprite: Locator): Promise<void> {
  await expect.poll(
    () => sprite.evaluate((root) => Array.from(root.querySelectorAll('img')).some((image) => (
      image.complete
      && image.naturalWidth > 0
      && (image.getAttribute('src') ?? '').startsWith('data:image/')
    ))),
    { timeout: 120_000 },
  ).toBe(true);
}

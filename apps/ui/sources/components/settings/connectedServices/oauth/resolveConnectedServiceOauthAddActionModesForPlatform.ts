import type { ConnectedServiceOauthAddMethod } from './resolveConnectedServiceOauthMode';

function normalizePlatformOS(platformOS: unknown): string {
  return typeof platformOS === 'string' ? platformOS.trim().toLowerCase() : '';
}

export function resolveConnectedServiceOauthAddActionModesForPlatform(params: Readonly<{
  platformOS: string;
  oauthAddActionModes?: ReadonlyArray<ConnectedServiceOauthAddMethod>;
  /** The desktop app, which signs in through the system browser and needs nothing pasted. */
  desktopBrowser?: boolean;
}>): ReadonlyArray<ConnectedServiceOauthAddMethod> {
  const platformOS = normalizePlatformOS(params.platformOS);
  const modes = (params.oauthAddActionModes ?? []).slice();

  // The desktop's browser sign-in finishes on its own, so it comes first.
  if (params.desktopBrowser === true && modes.includes('browser')) {
    return ['browser', ...modes.filter((m) => m !== 'browser')];
  }
  // Web cannot render embedded OAuthView (WebView), so hide the "browser" method.
  if (platformOS === 'web') return modes.filter((m) => m !== 'browser');
  return modes;
}

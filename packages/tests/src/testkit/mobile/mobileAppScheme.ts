const DEFAULT_APP_SCHEME = 'piggercode';

const APP_SCHEME_BY_APP_ID = new Map<string, string>([
  ['dev.happier.app.internaldev', 'piggercode-internaldev'],
  ['dev.happier.app.internaldev.devclient', 'piggercode-internaldev-devclient'],
  ['dev.happier.app.dev.internal.devclient', 'piggercode-internaldev'],
  ['dev.happier.app.publicdev', 'piggercode-dev'],
  ['dev.happier.app.publicdev.devclient', 'piggercode-dev-devclient'],
]);

export function resolveMobileAppScheme(
  env: NodeJS.ProcessEnv,
  options?: Readonly<{ appId?: string | null }>,
): string {
  const configured = String(
    env.PIGGERCODE_E2E_MOBILE_APP_SCHEME ??
    env.EXPO_APP_SCHEME ??
    '',
  ).trim();

  if (configured) return configured;

  const appId = String(options?.appId ?? '').trim();
  const appIdScheme = APP_SCHEME_BY_APP_ID.get(appId);
  return appIdScheme || DEFAULT_APP_SCHEME;
}

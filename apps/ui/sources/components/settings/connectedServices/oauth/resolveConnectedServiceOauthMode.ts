import type { ConnectedServiceId } from '@piggercode/protocol';

/** `loopback`: the desktop app opens the system browser and catches the redirect on this computer. */
export type ConnectedServiceOauthMode = 'device' | 'paste' | 'embedded' | 'loopback';
export type ConnectedServiceOauthAddMethod = 'device' | 'paste' | 'browser';

function normalizeMethod(method: unknown): string {
  return typeof method === 'string' ? method.trim().toLowerCase() : '';
}

export function resolveConnectedServiceOauthMode(params: Readonly<{
  platformOS: string;
  serviceId: ConnectedServiceId;
  method?: string;
  oauthAddActionModes?: ReadonlyArray<ConnectedServiceOauthAddMethod>;
  /** The desktop app, which can catch a sign-in redirect on this computer. */
  desktopBrowser?: boolean;
}>): ConnectedServiceOauthMode {
  const platformOS = String(params.platformOS ?? '').trim().toLowerCase();
  const method = normalizeMethod(params.method);

  const explicit: ConnectedServiceOauthMode | null =
    method === 'browser'
      ? 'embedded'
      : method === 'paste'
        ? 'paste'
        : method === 'device'
          ? 'device'
          : null;

  const fallbackMode = (() => {
    const preferred = params.oauthAddActionModes?.[0] ?? null;
    if (preferred === 'device') return 'device';
    if (preferred === 'paste') return 'paste';
    if (preferred === 'browser') return 'embedded';
    return 'paste';
  })();

  const allowDevice = (params.oauthAddActionModes ?? []).includes('device');
  const resolved = (() => {
    if (explicit === 'device' && !allowDevice) return 'paste';
    return explicit ?? fallbackMode;
  })();

  // A browser sign-in on the desktop runs in the system browser, which comes back to this computer.
  if (resolved === 'embedded' && params.desktopBrowser === true) return 'loopback';
  // Web cannot render embedded OAuthView, so treat it as paste.
  if (platformOS === 'web' && resolved === 'embedded') return 'paste';
  return resolved;
}

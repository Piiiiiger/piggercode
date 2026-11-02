/**
 * The relay this build offers as its built-in profile (settings id `cloud`; the id stays because credentials,
 * machine ids and daemon state are keyed by it). Its address is not part of the source: a machine names it with
 * PIGGERCODE_BUILTIN_RELAY_URL. Without it the profile points at a reserved address that never resolves, and
 * `setup --relay <address>` (which the app's setup guide prints) connects to a relay instead.
 */
const UNCONFIGURED_RELAY_URL = 'https://relay.invalid';

function readConfiguredRelayUrl(): string | null {
  const raw = String(process.env.PIGGERCODE_BUILTIN_RELAY_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const protocol = new URL(raw).protocol;
    return protocol === 'https:' || protocol === 'http:' ? raw : null;
  } catch {
    return null;
  }
}

const configuredRelayUrl = readConfiguredRelayUrl();

export const BUILTIN_RELAY = Object.freeze({
  name: 'PiggerCode',
  serverUrl: configuredRelayUrl ?? UNCONFIGURED_RELAY_URL,
  webappUrl: configuredRelayUrl ?? UNCONFIGURED_RELAY_URL,
  /** Whether this machine named the built-in relay's address. */
  configured: configuredRelayUrl !== null,
});

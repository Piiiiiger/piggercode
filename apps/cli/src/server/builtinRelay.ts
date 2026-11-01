/**
 * The relay this build ships as its built-in profile (settings id `cloud`): the server a fresh
 * install uses and the fallback when no profile is active. This fork ships its own relay instead
 * of Happier Cloud. The id stays `cloud` because credentials, machine ids and daemon state are
 * keyed by it.
 */
export const BUILTIN_RELAY = Object.freeze({
  name: 'Pigger',
  serverUrl: 'https://relay.example.test',
  webappUrl: 'https://relay.example.test',
});

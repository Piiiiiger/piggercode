import { createCatalogCliAuthSpec } from '@/capabilities/cliAuth/createCatalogCliAuthSpec';

/**
 * No login probe: agy 1.5.14 has no status command, and it keeps its sign-in in a file only where there
 * is no keyring, so a missing file would not mean signed out. Its login stays unknown and never hides
 * the agent; a session's own terminal signs in when needed.
 */
export const agyCliAuthSpec = createCatalogCliAuthSpec('agy', {});

import { realpath } from 'node:fs/promises';

/**
 * The identity of a Codex store for the session trash: its real path, so a symlinked alias of one Codex home
 * gives the same lock, the same trash entry and the same candidate filtering. A home that does not exist
 * (yet) keeps its lexical path.
 */
export async function canonicalCodexHomeIdentity(codexHome: string): Promise<string> {
  try {
    return await realpath(codexHome);
  } catch {
    return codexHome;
  }
}

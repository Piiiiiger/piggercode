import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';
import type { CodexDirectSessionHomeEntry } from '@/backends/codex/directSessions/resolveCodexHomeEntriesForDirectSessionsSource';

import {
  isCodexAppServerDefinitiveMethodNotFoundError,
  isCodexAppServerThreadAlreadyDeletedError,
} from '../appServerCompatibility';
import { createCodexAppServerClient } from '../client/createCodexAppServerClient';
import { resolveCodexAppServerProcessEnv } from '../resolveCodexAppServerProcessEnv';

/**
 * Deletes a thread through Codex's own app-server, so Codex removes the rollout
 * and its state rows together. `thread/delete` was verified on Codex 0.166.0.
 * Deleting a thread that is already gone succeeds, so a retried delete settles.
 */
export async function deleteCodexThreadViaAppServer(params: Readonly<{
  homeEntry: CodexDirectSessionHomeEntry;
  env: NodeJS.ProcessEnv;
  threadId: string;
}>): Promise<void> {
  const processEnv = await resolveCodexAppServerProcessEnv({
    processEnv: { ...process.env, ...params.env },
    affinity: {
      home: params.homeEntry.source.kind === 'codexHome' ? params.homeEntry.source.home : 'user',
      homePath: params.homeEntry.codexHome,
    },
  });
  const client = await createCodexAppServerClient({ processEnv });
  try {
    await client.request('thread/delete', { threadId: params.threadId });
  } catch (error) {
    if (isCodexAppServerThreadAlreadyDeletedError(error, params.threadId)) return;
    if (isCodexAppServerDefinitiveMethodNotFoundError(error, 'thread/delete')) {
      throw new DirectSessionsProviderUnavailableError(
        'This Codex version cannot delete sessions. Update Codex to 0.166.0 or newer.',
      );
    }
    throw error;
  } finally {
    await client.dispose().catch(() => undefined);
  }
}

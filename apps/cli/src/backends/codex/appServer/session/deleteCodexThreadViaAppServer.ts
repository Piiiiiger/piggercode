import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';
import type { CodexDirectSessionHomeEntry } from '@/backends/codex/directSessions/resolveCodexHomeEntriesForDirectSessionsSource';

import {
  isCodexAppServerDefinitiveMethodNotFoundError,
  isCodexAppServerThreadAlreadyDeletedError,
} from '../appServerCompatibility';
import { requestCodexThreadViaAppServer } from './requestCodexThreadViaAppServer';

type CodexThreadRequest = Readonly<{
  homeEntry: CodexDirectSessionHomeEntry;
  env: NodeJS.ProcessEnv;
  threadId: string;
}>;

/**
 * Deletes a thread through Codex's own app-server, so Codex removes the rollout
 * and its state rows together. `thread/delete` was verified on Codex 0.166.0.
 * Deleting a thread that is already gone succeeds, so a retried delete settles.
 */
export async function deleteCodexThreadViaAppServer(params: CodexThreadRequest): Promise<void> {
  try {
    await requestCodexThreadViaAppServer({ ...params, method: 'thread/delete' });
  } catch (error) {
    if (isCodexAppServerThreadAlreadyDeletedError(error, params.threadId)) return;
    if (isCodexAppServerDefinitiveMethodNotFoundError(error, 'thread/delete')) {
      throw new DirectSessionsProviderUnavailableError(
        'This Codex version cannot delete sessions. Update Codex to 0.166.0 or newer.',
      );
    }
    throw error;
  }
}

/**
 * Moves a thread out of Codex's own session list (`thread/archive`) or back into it
 * (`thread/unarchive`); Codex keeps the transcript either way. The trash holds a deleted
 * session's thread this way until it is restored or deleted for good.
 */
export async function setCodexThreadArchivedViaAppServer(params: CodexThreadRequest & Readonly<{ archived: boolean }>): Promise<void> {
  const method = params.archived ? 'thread/archive' : 'thread/unarchive';
  try {
    await requestCodexThreadViaAppServer({ ...params, method });
  } catch (error) {
    if (isCodexAppServerDefinitiveMethodNotFoundError(error, method)) {
      throw new DirectSessionsProviderUnavailableError(
        'This Codex version cannot move sessions to the trash. Update Codex.',
      );
    }
    throw error;
  }
}

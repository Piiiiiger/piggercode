import type { CodexDirectSessionHomeEntry } from '@/backends/codex/directSessions/resolveCodexHomeEntriesForDirectSessionsSource';

import { createCodexAppServerClient } from '../client/createCodexAppServerClient';
import { resolveCodexAppServerProcessEnv } from '../resolveCodexAppServerProcessEnv';

/**
 * Runs one thread-scoped request against Codex's own app-server for `homeEntry`'s Codex home and
 * disposes the client afterwards. The one place that builds this client for direct-session thread
 * mutations (delete, archive, unarchive).
 */
export async function requestCodexThreadViaAppServer(params: Readonly<{
  homeEntry: CodexDirectSessionHomeEntry;
  env: NodeJS.ProcessEnv;
  method: 'thread/delete' | 'thread/archive' | 'thread/unarchive';
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
    await client.request(params.method, { threadId: params.threadId });
  } finally {
    await client.dispose().catch(() => undefined);
  }
}

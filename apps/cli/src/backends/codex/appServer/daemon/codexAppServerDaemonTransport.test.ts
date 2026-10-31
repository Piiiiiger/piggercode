import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';
import { startFakeCodexAppServerDaemon } from '../testkit/fakeCodexAppServerDaemon';

import { isCodexThreadLoadedInAppServerDaemon } from './codexAppServerDaemonTransport';

describe.skipIf(process.platform === 'win32')('codexAppServerDaemonTransport', () => {
  it('reports only thread ids loaded by the running Codex daemon on its control socket', async () => {
    await withTempDir('happier-codex-daemon-transport-', async (root) => {
      const codexHome = join(root, '.codex');
      const daemon = await startFakeCodexAppServerDaemon({ codexHome, loadedThreadIds: ['loaded-thread'] });
      try {
        const processEnv = { ...process.env, CODEX_HOME: codexHome };

        await expect(isCodexThreadLoadedInAppServerDaemon({
          cwd: root,
          processEnv,
          threadId: 'loaded-thread',
        })).resolves.toBe(true);
        await expect(isCodexThreadLoadedInAppServerDaemon({
          cwd: root,
          processEnv,
          threadId: 'idle-thread',
        })).resolves.toBe(false);
      } finally {
        await daemon.close();
      }
    });
  });
});

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { projectSessionMetadataForWire } from '@piggercode/protocol';

import type { Credentials } from '@/persistence';
import { createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { withTempDir } from '@/testkit/fs/tempDir';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { reloadConfiguration } from '@/configuration';
import { acquireSessionRunnerLock, sessionRunnerLockPathForSessionId } from '@/daemon/sessionRunnerLock';
import { evaluateCliSessionAttachEligibility } from './evaluateCliSessionAttachEligibility';

const credentials: Credentials = {
  token: 'token-1',
  encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
};

const previousManagedServerStatePath = process.env.PIGGERCODE_CODEX_SERVER_STATE_PATH;

afterEach(() => {
  if (previousManagedServerStatePath === undefined) {
    delete process.env.PIGGERCODE_CODEX_SERVER_STATE_PATH;
    return;
  }
  process.env.PIGGERCODE_CODEX_SERVER_STATE_PATH = previousManagedServerStatePath;
});

describe('evaluateCliSessionAttachEligibility', () => {
  it.each(['live', 'unknown'] as const)('retains native provider admission for an active recorded Herdr pane with %s runner custody', async (runner) => {
    await withTempDir('happier-herdr-active-attach-', async (home) => {
      const env = createEnvKeyScope(['PIGGERCODE_HOME_DIR']);
      env.patch({ PIGGERCODE_HOME_DIR: home });
      reloadConfiguration();
      const sessionId = 'sid_active_recorded_herdr';
      const lock = runner === 'live' ? await acquireSessionRunnerLock({ sessionId, happyHomeDir: home }) : null;
      if (lock) expect(lock.ok).toBe(true);
      try {
        if (runner === 'unknown') {
          const lockPath = sessionRunnerLockPathForSessionId({ sessionId, happyHomeDir: home });
          if (!lockPath) throw new Error('Expected canonical runner lock path');
          await mkdir(dirname(lockPath), { recursive: true });
          await writeFile(lockPath, '{malformed', 'utf8');
        }
        const rawSession = createSessionRecordFixture({
          id: sessionId, active: true, encryptionMode: 'plain',
          metadata: JSON.stringify(projectSessionMetadataForWire({
            flavor: 'codex', machineId: 'machine-local', path: home,
            codexSessionId: 'same-native-session', codexBackendMode: 'appServer',
            terminal: { mode: 'herdr', herdr: {
              sessionName: 'work', socketPath: '/herdr/work.sock', paneId: 'w1:p2', terminalId: 'old-terminal',
            } },
          })),
        });
        await expect(evaluateCliSessionAttachEligibility({
          credentials, rawSession, currentMachineId: 'machine-local',
          localAttachmentInfo: null, insideTmux: false,
        })).resolves.toMatchObject({ eligible: true, attachStrategy: 'provider_attach' });
      } finally {
        if (lock?.ok) await lock.release();
        env.restore();
        reloadConfiguration();
      }
    });
  });

  it.each(['local', 'remote', 'missing-pane', 'archived', 'retired'] as const)(
    'opens inactive preserved Herdr panes only as local restoration candidates (%s)',
    async (state) => {
      const rawSession = {
        ...createSessionRecordFixture({
          id: 'sid_cold_herdr', active: false, encryptionMode: 'plain',
          metadata: JSON.stringify(projectSessionMetadataForWire({
            flavor: 'claude', machineId: state === 'remote' ? 'machine-remote' : 'machine-local',
            host: state === 'remote' ? 'remote-host' : 'local-host', path: '/project',
            terminal: { mode: 'herdr', ...(state === 'retired' ? { controlServiceabilityV1: {
              v: 1, state: 'unknown', observedAt: 1, retired: true,
            } } : {}), herdr: {
              sessionName: 'work', socketPath: '/herdr/work.sock', terminalId: 'old-terminal',
              ...(state === 'missing-pane' ? {} : { paneId: 'w1:p2' }),
            } },
          })),
        }),
        ...(state === 'archived' ? { archivedAt: 1 } : {}),
      };
      const eligibility = await evaluateCliSessionAttachEligibility({
        credentials, rawSession, currentMachineId: 'machine-local', currentMachineHost: 'local-host',
        localAttachmentInfo: null, insideTmux: false,
      });
      if (state === 'local') {
        expect(eligibility).toMatchObject({ eligible: true, attachStrategy: 'terminal_host', attachScope: 'local' });
      } else {
        expect(eligibility).toMatchObject({ eligible: false });
      }
    },
  );

  it('rejects sessions from a different physical host even when synced tmux metadata exists', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_remote_tmux_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-remote',
        flavor: 'claude',
        host: 'office-imac',
        path: '/tmp/workspace',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-1' },
        },
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-local',
      currentMachineHost: 'leeroy-mbp',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: false,
      reasonCode: 'not_current_machine',
    });
  });

  it('accepts a local terminal marker even when the session machine identity changed', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_local_marker_after_machine_rotation_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-before-reauth',
        flavor: 'claude',
        host: 'leeroy-mbp',
        path: '/tmp/workspace',
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-after-reauth',
      currentMachineHost: 'leeroy-mbp',
      localAttachmentInfo: {
        version: 1,
        sessionId: 'sid_local_marker_after_machine_rotation_1',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-1' },
        },
        updatedAt: Date.now(),
      },
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: true,
      attachStrategy: 'terminal_host',
      agentId: 'claude',
      attachScope: 'local',
      plan: expect.objectContaining({ type: 'tmux', target: 'happy:session-1' }),
    });
  });

  it('accepts same-host synced tmux metadata when the machine identity differs and no local marker exists', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_same_host_synced_tmux_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-from-ui',
        flavor: 'claude',
        host: 'leeroy-mbp',
        path: '/tmp/workspace',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-2' },
        },
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-from-cli',
      currentMachineHost: 'leeroy-mbp.local',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: true,
      attachStrategy: 'terminal_host',
      agentId: 'claude',
      attachScope: 'local',
      plan: expect.objectContaining({ type: 'tmux', target: 'happy:session-2' }),
    });
  });

  it('accepts same-host synced tmux metadata when the current machine id is unavailable and no local marker exists', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_same_host_missing_current_machine_id_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-from-ui',
        flavor: 'claude',
        host: 'leeroy-mbp',
        path: '/tmp/workspace',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-3' },
        },
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: null,
      currentMachineHost: 'leeroy-mbp.local',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: true,
      attachStrategy: 'terminal_host',
      agentId: 'claude',
      attachScope: 'local',
      plan: expect.objectContaining({ type: 'tmux', target: 'happy:session-3' }),
    });
  });

  it('rejects same-host synced tmux metadata when the session machine id is unavailable and no local marker exists', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_same_host_missing_session_machine_id_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        flavor: 'claude',
        host: 'leeroy-mbp',
        path: '/tmp/workspace',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-4' },
        },
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-from-cli',
      currentMachineHost: 'leeroy-mbp.local',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: false,
      reasonCode: 'session_machine_unknown',
    });
  });

  it('accepts tmux-backed terminal attach from same-host synced metadata without a local marker', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_local_tmux_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        flavor: 'claude',
        host: 'leeroy-mbp',
        path: '/tmp/workspace',
        terminal: {
          mode: 'tmux',
          requested: 'tmux',
          tmux: { target: 'happy:session-1' },
        },
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-local',
      currentMachineHost: 'leeroy-mbp.local',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: true,
      attachStrategy: 'terminal_host',
      agentId: 'claude',
      attachScope: 'local',
      plan: expect.objectContaining({ type: 'tmux', target: 'happy:session-1' }),
    });
  });

  it('accepts provider-attach sessions on the current machine without local terminal attachment state', async () => {
    const rawSession = createSessionRecordFixture({
      id: 'sid_local_codex_1',
      active: true,
      encryptionMode: 'plain',
      metadata: JSON.stringify({
        machineId: 'machine-local',
        flavor: 'codex',
        path: '/tmp/codex-workspace',
        codexSessionId: 'codex-session-1',
        codexBackendMode: 'appServer',
      }),
    });

    await expect(evaluateCliSessionAttachEligibility({
      credentials,
      rawSession,
      currentMachineId: 'machine-local',
      localAttachmentInfo: null,
      insideTmux: false,
    })).resolves.toMatchObject({
      eligible: true,
      attachStrategy: 'provider_attach',
      agentId: 'codex',
      attachScope: 'local',
    });
  });
});

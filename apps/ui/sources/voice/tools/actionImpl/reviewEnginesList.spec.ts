import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackendTargetKey } from '@piggercode/protocol';
import { installVoiceToolActionImplCommonModuleMocks } from './voiceToolActionImplTestHelpers';

const state: any = {
  settings: {
    backendEnabledByTargetKey: {
    },
  },
  sessions: {
    s1: {
      id: 's1',
      metadata: {
        machineId: 'm1',
      },
    },
  },
};

const getMachineCapabilitiesSnapshot = vi.fn();

installVoiceToolActionImplCommonModuleMocks({
  storage: async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
      storage: {
        getState: () => state,
      } as typeof import('@/sync/domains/state/storage').storage,
    });
  },
});

vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
  getMachineCapabilitiesSnapshot: (...args: any[]) => getMachineCapabilitiesSnapshot(...args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
  getActiveServerSnapshot: () => ({ serverId: 'server-a' }),
}));

describe('review engine voice tool', () => {
  beforeEach(() => {
    state.settings.backendEnabledByTargetKey = {
    };
    getMachineCapabilitiesSnapshot.mockReset();
    getMachineCapabilitiesSnapshot.mockReturnValue({
      response: {
        results: {
          'tool.executionRuns': {
            ok: true,
            data: {
              backends: {
                codex: { available: true, intents: ['review'] },
                claude: { available: false, intents: ['review'] },
              },
            },
          },
        },
      },
    });
  });

  it('filters disabled review engines by default', async () => {
    const { listReviewEnginesForVoiceTool } = await import('./reviewEnginesList');
    const res: any = await listReviewEnginesForVoiceTool({ sessionId: 's1' });

    expect(res.items.map((item: any) => item.engineId)).toEqual(expect.arrayContaining(['codex']));
    expect(res.items.map((item: any) => item.engineId)).not.toContain('claude');
  });

  it('includes disabled review engines when explicitly requested', async () => {
    const { listReviewEnginesForVoiceTool } = await import('./reviewEnginesList');
    const res: any = await listReviewEnginesForVoiceTool({ sessionId: 's1', includeDisabled: true });

    const claude = (res.items ?? []).find((item: any) => item.engineId === 'claude');
    expect(claude).toBeTruthy();
    expect(claude.enabled).toBe(false);
  });

  it('loads review engine capabilities from the resolved session machine target', async () => {
    state.sessions.s1 = {
      id: 's1',
      active: false,
      metadata: {
        machineId: 'm-old',
        path: '/workspace/repo',
      },
    };
    state.machines = {
      'm-old': {
        id: 'm-old',
        active: false,
        activeAt: 1,
        replacedByMachineId: 'm-target',
        replacedAt: 2,
        metadata: { host: 'old.local' },
      },
      'm-target': {
        id: 'm-target',
        active: true,
        activeAt: 3,
        metadata: { host: 'target.local' },
      },
    };

    const { listReviewEnginesForVoiceTool } = await import('./reviewEnginesList');
    await listReviewEnginesForVoiceTool({ sessionId: 's1' });

    expect(getMachineCapabilitiesSnapshot).toHaveBeenCalledWith('m-target', 'server-a');
  });
});

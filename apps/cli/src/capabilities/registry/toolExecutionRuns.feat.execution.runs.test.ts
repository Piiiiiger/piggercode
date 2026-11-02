import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENTS } from '@/backends/catalog';
import { executionRunsCapability } from './toolExecutionRuns';
import type { DetectCliEntry, DetectCliSnapshot } from '../snapshots/cliSnapshot';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { ExecutionRunIntentSchema } from '@piggercode/protocol';

function makeUnavailableCliEntry(): DetectCliEntry {
  return { available: false };
}

function makeCliSnapshot(overrides: Partial<DetectCliSnapshot['clis']>, path = ''): DetectCliSnapshot {
  const baseClis = Object.fromEntries(
    (Object.keys(AGENTS) as Array<keyof typeof AGENTS>).map((agentId) => [agentId, makeUnavailableCliEntry()] as const),
  );
  return {
    path,
    clis: {
      ...(baseClis as DetectCliSnapshot['clis']),
      ...overrides,
    },
    tmux: { available: false },
    windowsTerminal: { available: false },
  };
}

describe('executionRunsCapability', () => {
  const envScope = createEnvKeyScope(['PIGGERCODE_CODEX_BACKEND_MODE']);

  beforeEach(() => {
    envScope.restore();
    envScope.patch({
      PIGGERCODE_CODEX_BACKEND_MODE: undefined,
    });
  });

  afterEach(() => {
    envScope.restore();
  });

  it('reports supportsVendorResume per backend for UI gating', async () => {
    const res = await executionRunsCapability.detect({
      context: {
        cliSnapshot: makeCliSnapshot({ claude: { available: true }, codex: { available: true } }),
      },
      request: { id: 'tool.executionRuns' },
    }) as {
      available: boolean;
      backends: Record<string, { supportsVendorResume?: boolean; available?: boolean }>;
    };

    expect(res?.available).toBe(true);
    expect(res?.backends?.claude).toBeTruthy();
    expect(typeof res.backends.claude.supportsVendorResume).toBe('boolean');
    expect(res.backends.codex).toMatchObject({
      available: true,
      supportsVendorResume: true,
    });
  });

  it('reports Codex resume support from the effective runtime mode (PIGGERCODE_CODEX_BACKEND_MODE)', async () => {
    process.env.PIGGERCODE_CODEX_BACKEND_MODE = 'mcp';

    const res = await executionRunsCapability.detect({
      context: {
        cliSnapshot: makeCliSnapshot({ codex: { available: true } }),
      },
      request: { id: 'tool.executionRuns' },
    }) as {
      available: boolean;
      backends: Record<string, { supportsVendorResume?: boolean; available?: boolean }>;
    };

    expect(res?.available).toBe(true);
    expect(res.backends.codex).toMatchObject({
      available: true,
      supportsVendorResume: false,
    });
  });

  it('reuses the common intent list for catalog-backed execution runs', async () => {
    const res = await executionRunsCapability.detect({
      context: {
        cliSnapshot: makeCliSnapshot({ claude: { available: true }, codex: { available: true } }),
      },
      request: { id: 'tool.executionRuns' },
    }) as {
      available: boolean;
      intents: readonly string[];
      backends: Record<string, { intents: readonly string[]; available?: boolean; supportsVendorResume?: boolean }>;
    };

    expect(Object.keys(res.backends).slice().sort()).toEqual(Object.keys(AGENTS).slice().sort());

    for (const backendId of Object.keys(AGENTS)) {
      expect(res.backends[backendId]?.intents).toBe(res.intents);
    }
  });

  it('returns only protocol-defined execution-run intents', async () => {
    const res = await executionRunsCapability.detect({
      context: {
        cliSnapshot: makeCliSnapshot({ claude: { available: true }, codex: { available: true } }),
      },
      request: { id: 'tool.executionRuns' },
    }) as {
      available: boolean;
      intents: readonly string[];
      backends: Record<string, { intents: readonly string[] }>;
    };

    for (const intent of res.intents) {
      expect(ExecutionRunIntentSchema.safeParse(intent).success).toBe(true);
    }
    for (const backend of Object.values(res.backends)) {
      for (const intent of backend.intents) {
        expect(ExecutionRunIntentSchema.safeParse(intent).success).toBe(true);
      }
    }
  });
});

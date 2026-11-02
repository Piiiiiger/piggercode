import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from '../../src/testkit/providers/scenarios/scenarioCatalog';
import type { ProviderFixtures, ProviderUnderTest } from '../../src/testkit/providers/types';

function baseVerifyContext(overrides: Partial<{
  workspaceDir: string;
  fixtures: ProviderFixtures;
}>) {
  return {
    workspaceDir: overrides.workspaceDir ?? '/tmp',
    fixtures: overrides.fixtures ?? { examples: {} },
    traceEvents: [],
    baseUrl: 'http://127.0.0.1:1',
    token: 'token',
    sessionId: 'session',
    resumeSessionId: null,
    secret: new Uint8Array(32),
    resumeId: null,
  };
}

function acpProvider(id: string): ProviderUnderTest {
  return {
    id,
    enableEnvVar: `PIGGERCODE_E2E_PROVIDER_${id.toUpperCase()}`,
    protocol: 'acp',
    traceProvider: id,
    scenarioRegistry: { v: 1, tiers: { smoke: ['execute_trace_ok'], extended: [] } },
    cli: { subcommand: id },
  };
}

describe('scenarioCatalog: execute normalization', () => {
  it('allows codex execute_trace_ok to include optional pre-execute helper tool calls', () => {
    const scenario = scenarioCatalog.execute_trace_ok(acpProvider('codex'));
    expect(scenario.maxTraceEvents).toEqual({ toolCalls: 3, toolResults: 3 });
  });

});

import { describe, expect, it } from 'vitest';

import { abortContinuationFollowupSubstrings, scenarioCatalog } from '../../src/testkit/providers/scenarios/scenarioCatalog';
import type { ProviderUnderTest } from '../../src/testkit/providers/types';

function providerStub(id: ProviderUnderTest['id'], protocol: ProviderUnderTest['protocol'], subcommand: string): ProviderUnderTest {
  return {
    id,
    protocol,
    enableEnvVar: `PIGGERCODE_E2E_PROVIDER_${String(id).toUpperCase()}`,
    traceProvider: protocol === 'acp' ? String(id) : 'claude',
    scenarioRegistry: { v: 1, tiers: { smoke: [], extended: [] } },
    cli: { subcommand },
  };
}

describe('scenarioCatalog: abort continuation contract', () => {

  it('builds a claude abort-continue scenario with post-satisfaction runner', () => {
    const scenario = scenarioCatalog.abort_turn_then_continue(providerStub('claude', 'claude', 'claude'));
    expect(scenario.id).toBe('abort_turn_then_continue');
    expect(scenario.tier).toBe('extended');
    expect(scenario.yolo).toBe(true);
    expect(scenario.requiredFixtureKeys).toEqual([]);
    expect(scenario.requiredAnyFixtureKeys).toBeUndefined();
    expect(typeof scenario.postSatisfy?.run).toBe('function');
    expect(typeof scenario.verify).toBe('function');
  });

});

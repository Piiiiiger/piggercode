import { describe, expect, it } from 'vitest';
import { AGENT_IDS, hasBuiltInAcpConfig } from '@piggercode/agents';

import { loadProvidersFromCliSpecs } from '../../src/testkit/providers/specs/providerSpecs';
import { resolveScenarioById } from '../../src/testkit/providers/harness/scenarioSelection';

describe('providers: scenario capability gating', () => {

  it('keeps Codex runtime provider-lane scenarios ACP-scoped and limits app-server coverage to targeted capabilities', async () => {
    const providers = await loadProvidersFromCliSpecs();
    const codex = providers.find((provider) => provider.id === 'codex');
    expect(codex).toBeTruthy();

    const allScenarioIds = [
      ...codex!.scenarioRegistry.tiers.smoke,
      ...codex!.scenarioRegistry.tiers.extended,
    ];

    expect(codex!.coverageExpectation).toEqual({
      providerLaneScope: 'acp-only',
      defaultRuntimePath: 'appServer',
      appServerCoverage: 'capability-contract',
      appServerCapabilitySurfaces: ['modes', 'models', 'speed', 'rollback'],
    });
    expect(codex!.scenarioRegistry.tiers.smoke).toContain('acp_probe_capabilities');
    expect(allScenarioIds.some((scenarioId) => /app(?:-|_)?server/i.test(scenarioId))).toBe(false);
    expect(codex!.cli?.env?.PIGGERCODE_CODEX_BACKEND_MODE).toBe('acp');
  });

});

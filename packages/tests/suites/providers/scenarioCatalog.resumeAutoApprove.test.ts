import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from '../../src/testkit/providers/scenarios/scenarioCatalog';
import type { ProviderUnderTest } from '../../src/testkit/providers/types';

describe('providers: resume scenario permission auto-approve policy', () => {
  const codexProvider = {
    id: 'codex',
    protocol: 'acp',
    enableEnvVar: 'PIGGERCODE_E2E_PROVIDER_CODEX',
    traceProvider: 'codex',
    scenarioRegistry: { v: 1, tiers: { smoke: [], extended: [] } },
    cli: { subcommand: 'codex' },
  } satisfies ProviderUnderTest;

  it('enables permission auto-approve in yolo for resume load-session scenario', () => {
    const scenario = scenarioCatalog.acp_resume_load_session(codexProvider);
    expect(scenario.yolo).toBe(true);
    expect(scenario.allowPermissionAutoApproveInYolo).toBe(true);
  });

});

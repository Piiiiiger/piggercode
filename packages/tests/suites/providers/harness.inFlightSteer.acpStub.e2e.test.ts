import { describe, expect, it } from 'vitest';

import { runProviderContractMatrix } from '../../src/testkit/providers/harness';

describe('providers harness: in-flight steer (acp stub provider)', () => {
  const providersEnabled = (process.env.PIGGERCODE_E2E_PROVIDERS ?? '').toString().trim() === '1';
  const stubEnabled = (process.env.PIGGERCODE_E2E_PROVIDER_CODEX_ACP_STUB ?? '').toString().trim() === '1';

  it.skipIf(!(providersEnabled && stubEnabled))(
    'routes a second message as in-flight steer (no interrupt) and completes with expected trace markers',
    async () => {
      const envVars = [
        'PIGGERCODE_E2E_PROVIDERS',
        'PIGGERCODE_E2E_PROVIDER_CODEX_ACP_STUB',
        'PIGGERCODE_E2E_PROVIDER_CLAUDE',
        'PIGGERCODE_E2E_PROVIDER_CODEX',
        'PIGGERCODE_E2E_PROVIDER_SCENARIOS',
      ] as const;

      const saved: Record<string, string | undefined> = {};
      for (const key of envVars) saved[key] = process.env[key];

      try {
        process.env.PIGGERCODE_E2E_PROVIDERS = '1';
        // Ensure the matrix only runs the deterministic ACP stub provider.
        process.env.PIGGERCODE_E2E_PROVIDER_CODEX_ACP_STUB = '1';
        process.env.PIGGERCODE_E2E_PROVIDER_CLAUDE = '0';
        process.env.PIGGERCODE_E2E_PROVIDER_CODEX = '0';

        // This scenario is provider-agnostic (ACP) and should be reusable for future ACP providers
        // that publish in-flight steer support.
        process.env.PIGGERCODE_E2E_PROVIDER_SCENARIOS = 'acp_in_flight_steer';

        const res = await runProviderContractMatrix();
        if (!res.ok) throw new Error(res.error);
        expect(res.ok).toBe(true);
        expect(res.skipped).toBeUndefined();
      } finally {
        for (const key of envVars) {
          const value = saved[key];
          if (typeof value === 'string') process.env[key] = value;
          else delete process.env[key];
        }
      }
    },
    900_000,
  );
});

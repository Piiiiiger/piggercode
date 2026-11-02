import { describe, expect, it } from 'vitest';

import { runProviderContractMatrix } from '../../src/testkit/providers/harness';

describe('providers harness: in-flight steer (codex ACP)', () => {
  const providersEnabled = (process.env.PIGGERCODE_E2E_PROVIDERS ?? '').toString().trim() === '1';
  const codexEnabled = (process.env.PIGGERCODE_E2E_PROVIDER_CODEX ?? '').toString().trim() === '1';

  it.skipIf(!(providersEnabled && codexEnabled))(
    'routes a second message as in-flight steer (no interrupt) using real Codex ACP',
    async () => {
      const envVars = [
        'PIGGERCODE_E2E_PROVIDER_CODEX_ACP_STUB',
        'PIGGERCODE_E2E_PROVIDER_CLAUDE',
        'PIGGERCODE_E2E_PROVIDER_CODEX',
        'PIGGERCODE_E2E_PROVIDER_SCENARIOS',
      ] as const;

      const saved: Record<string, string | undefined> = {};
      for (const key of envVars) saved[key] = process.env[key];

      try {
        process.env.PIGGERCODE_E2E_PROVIDER_CODEX_ACP_STUB = '0';
        process.env.PIGGERCODE_E2E_PROVIDER_CLAUDE = '0';
        process.env.PIGGERCODE_E2E_PROVIDER_CODEX = '1';

        process.env.PIGGERCODE_E2E_PROVIDER_SCENARIOS = 'acp_in_flight_steer';

        const res = await runProviderContractMatrix();
        if (!res.ok) throw new Error(res.error);
        expect(res.ok).toBe(true);
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

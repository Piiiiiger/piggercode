import { describe, expect, it } from 'vitest';

import { envFlag } from '../../src/testkit/env';

describe('providers: tool-trace contract (scaffold)', () => {
  const providersEnabled = envFlag('PIGGERCODE_E2E_PROVIDERS', false) || envFlag('HAPPY_E2E_PROVIDERS', false);

  it.skipIf(providersEnabled)('is disabled by default (set PIGGERCODE_E2E_PROVIDERS=1 to enable)', () => {
    expect(providersEnabled).toBe(false);
  });
});

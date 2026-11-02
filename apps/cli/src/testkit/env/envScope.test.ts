import { describe, expect, it } from 'vitest';

describe('env scope helpers', () => {
  it('patches and restores selected environment keys', async () => {
    const envScope = await import('@/testkit/env/envScope').catch(() => null);

    expect(envScope).not.toBeNull();
    expect(envScope?.createEnvKeyScope).toBeTypeOf('function');

    const previous = process.env.PIGGERCODE_TESTKIT_ENV_SCOPE;
    const scope = envScope!.createEnvKeyScope(['PIGGERCODE_TESTKIT_ENV_SCOPE']);

    try {
      scope.patch({ PIGGERCODE_TESTKIT_ENV_SCOPE: 'patched' });
      expect(process.env.PIGGERCODE_TESTKIT_ENV_SCOPE).toBe('patched');
    } finally {
      scope.restore();
      if (previous === undefined) {
        expect(process.env.PIGGERCODE_TESTKIT_ENV_SCOPE).toBeUndefined();
      } else {
        expect(process.env.PIGGERCODE_TESTKIT_ENV_SCOPE).toBe(previous);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  applyEnvOverrides,
  applyEnvValues,
  envFlag,
  restoreEnvValues,
  restoreProcessEnv,
  snapshotEnvValues,
  snapshotProcessEnv,
  withEnvOverrides,
} from './env';

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

describe('envFlag', () => {
  it('accepts PIGGERCODE_* flags', () => {
    const prev = process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS = '1';
    try {
      expect(envFlag('PIGGERCODE_E2E_SAVE_ARTIFACTS', false)).toBe(true);
    } finally {
      restoreEnv('PIGGERCODE_E2E_SAVE_ARTIFACTS', prev);
    }
  });

  it('falls back from PIGGERCODE_* to HAPPY_* when unset', () => {
    const prevHappier = process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    const prevHappy = process.env.HAPPY_E2E_SAVE_ARTIFACTS;
    delete process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    process.env.HAPPY_E2E_SAVE_ARTIFACTS = '1';
    try {
      expect(envFlag('PIGGERCODE_E2E_SAVE_ARTIFACTS', false)).toBe(true);
    } finally {
      restoreEnv('PIGGERCODE_E2E_SAVE_ARTIFACTS', prevHappier);
      restoreEnv('HAPPY_E2E_SAVE_ARTIFACTS', prevHappy);
    }
  });

  it('falls back from HAPPY_* to PIGGERCODE_* when unset', () => {
    const prevHappier = process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    const prevHappy = process.env.HAPPY_E2E_SAVE_ARTIFACTS;
    delete process.env.HAPPY_E2E_SAVE_ARTIFACTS;
    process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS = '1';
    try {
      expect(envFlag('HAPPY_E2E_SAVE_ARTIFACTS', false)).toBe(true);
    } finally {
      restoreEnv('PIGGERCODE_E2E_SAVE_ARTIFACTS', prevHappier);
      restoreEnv('HAPPY_E2E_SAVE_ARTIFACTS', prevHappy);
    }
  });

  it('accepts multiple keys and returns the first match', () => {
    const prevHappier = process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    const prevHappy = process.env.HAPPY_E2E_SAVE_ARTIFACTS;
    delete process.env.PIGGERCODE_E2E_SAVE_ARTIFACTS;
    process.env.HAPPY_E2E_SAVE_ARTIFACTS = '1';
    try {
      expect(envFlag(['PIGGERCODE_E2E_SAVE_ARTIFACTS', 'HAPPY_E2E_SAVE_ARTIFACTS'], false)).toBe(true);
    } finally {
      restoreEnv('PIGGERCODE_E2E_SAVE_ARTIFACTS', prevHappier);
      restoreEnv('HAPPY_E2E_SAVE_ARTIFACTS', prevHappy);
    }
  });
});

describe('applyEnvOverrides', () => {
  it('restores previous values after applying overrides', () => {
    const prevEnabled = process.env.PIGGERCODE_TEST_ENABLED;
    const prevRemoved = process.env.PIGGERCODE_TEST_REMOVED;
    process.env.PIGGERCODE_TEST_ENABLED = 'before';
    process.env.PIGGERCODE_TEST_REMOVED = 'remove-me';

    const restore = applyEnvOverrides({
      PIGGERCODE_TEST_ENABLED: 'after',
      PIGGERCODE_TEST_REMOVED: undefined,
      PIGGERCODE_TEST_CREATED: 'created',
    });

    expect(process.env.PIGGERCODE_TEST_ENABLED).toBe('after');
    expect(process.env.PIGGERCODE_TEST_REMOVED).toBeUndefined();
    expect(process.env.PIGGERCODE_TEST_CREATED).toBe('created');

    restore();

    expect(process.env.PIGGERCODE_TEST_ENABLED).toBe('before');
    expect(process.env.PIGGERCODE_TEST_REMOVED).toBe('remove-me');
    expect(process.env.PIGGERCODE_TEST_CREATED).toBeUndefined();

    restoreEnv('PIGGERCODE_TEST_ENABLED', prevEnabled);
    restoreEnv('PIGGERCODE_TEST_REMOVED', prevRemoved);
  });
});

describe('withEnvOverrides', () => {
  it('restores env after a successful callback', async () => {
    const prev = process.env.PIGGERCODE_TEST_SCOPED;
    process.env.PIGGERCODE_TEST_SCOPED = 'before';

    await withEnvOverrides({ PIGGERCODE_TEST_SCOPED: 'during' }, async () => {
      expect(process.env.PIGGERCODE_TEST_SCOPED).toBe('during');
    });

    expect(process.env.PIGGERCODE_TEST_SCOPED).toBe('before');
    restoreEnv('PIGGERCODE_TEST_SCOPED', prev);
  });

  it('restores env after a failing callback', async () => {
    const prev = process.env.PIGGERCODE_TEST_FAILING_SCOPE;
    delete process.env.PIGGERCODE_TEST_FAILING_SCOPE;

    await expect(
      withEnvOverrides({ PIGGERCODE_TEST_FAILING_SCOPE: 'during' }, async () => {
        expect(process.env.PIGGERCODE_TEST_FAILING_SCOPE).toBe('during');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(process.env.PIGGERCODE_TEST_FAILING_SCOPE).toBeUndefined();
    restoreEnv('PIGGERCODE_TEST_FAILING_SCOPE', prev);
  });
});

describe('env snapshots', () => {
  it('captures and restores selected values', () => {
    const prevAlpha = process.env.PIGGERCODE_TEST_ALPHA;
    const prevBeta = process.env.PIGGERCODE_TEST_BETA;

    process.env.PIGGERCODE_TEST_ALPHA = 'before-alpha';
    delete process.env.PIGGERCODE_TEST_BETA;

    const snapshot = snapshotEnvValues(['PIGGERCODE_TEST_ALPHA', 'PIGGERCODE_TEST_BETA']);
    applyEnvValues({
      PIGGERCODE_TEST_ALPHA: 'after-alpha',
      PIGGERCODE_TEST_BETA: 'after-beta',
    });

    expect(process.env.PIGGERCODE_TEST_ALPHA).toBe('after-alpha');
    expect(process.env.PIGGERCODE_TEST_BETA).toBe('after-beta');

    restoreEnvValues(snapshot);

    expect(process.env.PIGGERCODE_TEST_ALPHA).toBe('before-alpha');
    expect(process.env.PIGGERCODE_TEST_BETA).toBeUndefined();

    restoreEnv('PIGGERCODE_TEST_ALPHA', prevAlpha);
    restoreEnv('PIGGERCODE_TEST_BETA', prevBeta);
  });

  it('captures and restores the full process env', () => {
    const snapshot = snapshotProcessEnv();
    const injectedKey = 'PIGGERCODE_TEST_FULL_RESTORE';
    const originalPath = process.env.PATH;

    process.env[injectedKey] = 'temporary';
    delete process.env.PATH;

    restoreProcessEnv(snapshot);

    expect(process.env[injectedKey]).toBeUndefined();
    expect(process.env.PATH).toBe(originalPath);
  });
});

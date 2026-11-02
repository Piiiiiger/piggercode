import { describe, expect, it } from 'vitest';

import {
  PIGGERCODE_SESSION_ID_ENV_KEY,
  readCurrentHappierSessionIdFromEnv,
  withCurrentHappierSessionId,
} from './currentSessionIdEnv';

describe('currentSessionIdEnv', () => {
  it('binds a child environment to the current PiggerCode session', () => {
    const env = withCurrentHappierSessionId({ PATH: '/bin' }, 'session-123');

    expect(env).toEqual({
      PATH: '/bin',
      [PIGGERCODE_SESSION_ID_ENV_KEY]: 'session-123',
    });
    expect(readCurrentHappierSessionIdFromEnv(env)).toBe('session-123');
  });

  it.each(['', '   ', 'offline-123'])(
    'clears an inherited caller session for unresolved id %j',
    (sessionId) => {
      const env = withCurrentHappierSessionId({
        [PIGGERCODE_SESSION_ID_ENV_KEY]: 'outer-session',
      }, sessionId);

      expect(readCurrentHappierSessionIdFromEnv(env)).toBeNull();
      expect(env).not.toHaveProperty(PIGGERCODE_SESSION_ID_ENV_KEY);
    },
  );

  it.each([undefined, '', '   ', 'offline-123'])(
    'does not expose unusable ambient session id %j',
    (sessionId) => {
      expect(readCurrentHappierSessionIdFromEnv({
        [PIGGERCODE_SESSION_ID_ENV_KEY]: sessionId,
      })).toBeNull();
    },
  );
});

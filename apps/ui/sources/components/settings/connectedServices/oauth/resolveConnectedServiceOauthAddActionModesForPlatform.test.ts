import { describe, expect, it } from 'vitest';

import { resolveConnectedServiceOauthAddActionModesForPlatform } from './resolveConnectedServiceOauthAddActionModesForPlatform';

describe('resolveConnectedServiceOauthAddActionModesForPlatform', () => {
  it('puts the browser sign-in first on the desktop app, hides it on the plain web and keeps it on phones', () => {
    expect(resolveConnectedServiceOauthAddActionModesForPlatform({
      platformOS: 'web',
      oauthAddActionModes: ['paste', 'browser'],
      desktopBrowser: true,
    })).toEqual(['browser', 'paste']);
    expect(resolveConnectedServiceOauthAddActionModesForPlatform({
      platformOS: 'web',
      oauthAddActionModes: ['device', 'paste', 'browser'],
    })).toEqual(['device', 'paste']);
    expect(resolveConnectedServiceOauthAddActionModesForPlatform({
      platformOS: 'ios',
      oauthAddActionModes: ['paste', 'browser'],
    })).toEqual(['paste', 'browser']);
  });
});

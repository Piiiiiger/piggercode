import { describe, expect, it } from 'vitest';

import { defaultServerLocation, parseServerLocation } from './serverLocation';

describe('where a shared folder shows on the server', () => {
  it('is the folder\'s own name beside the home\'s other folders unless named otherwise', () => {
    expect(defaultServerLocation('code')).toBe('code');
    expect(defaultServerLocation('work/app')).toBe('app');
    expect(parseServerLocation('~/code')).toEqual({ ok: true, at: 'code' });
    expect(parseServerLocation('projects/app/')).toEqual({ ok: true, at: 'projects/app' });
  });

  it('stays inside the home, out of hidden folders and off the command path', () => {
    for (const refused of ['', '~', '/srv/code', '../etc', 'a/../b', '.ssh', 'work/.config', '-x', 'bin', 'bin/tools', 'a\tb', 'a\\b', "it's", 'say"hi', 'local', 'local/laptop/code']) {
      expect(parseServerLocation(refused).ok).toBe(false);
    }
    expect(parseServerLocation('binaries').ok).toBe(true);
  });
});

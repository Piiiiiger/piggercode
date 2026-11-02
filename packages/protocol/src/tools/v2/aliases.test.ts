import { describe, expect, it } from 'vitest';

import { isChangeTitleToolLikeName, isChangeTitleToolNameAlias } from './aliases.js';

describe('tools/v2 aliases', () => {

  it('treats session_title_set MCP aliases as change_title aliases', () => {
    expect(isChangeTitleToolNameAlias('session_title_set')).toBe(true);
    expect(isChangeTitleToolNameAlias('mcp__piggercode__session_title_set')).toBe(true);
  });

  it('keeps recognizing title changes recorded under the upstream server name', () => {
    expect(isChangeTitleToolNameAlias('mcp__happier__change_title')).toBe(true);
    expect(isChangeTitleToolNameAlias('happier__session_title_set')).toBe(true);
  });

  it('treats provider display names for title changes as change_title-like names', () => {
    expect(isChangeTitleToolLikeName('Change Title')).toBe(true);
    expect(isChangeTitleToolLikeName('Set session title')).toBe(true);
  });

  it('does not treat slash-style server/tool names as direct change_title aliases', () => {
    expect(isChangeTitleToolNameAlias('happier/change_title')).toBe(false);
    expect(isChangeTitleToolNameAlias('happy/change_title')).toBe(false);
  });
});

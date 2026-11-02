import { describe, expect, it } from 'vitest';

import { PIGGERCODE_BASE_SYSTEM_PROMPT_V1 } from './systemPromptBaseV1.js';

describe('PIGGERCODE_BASE_SYSTEM_PROMPT_V1', () => {
  it('documents inline @path workspace file references', () => {
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('Linked workspace files');
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('`@path`');
  });

  it('mentions change_title for session titles', () => {
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('change_title');
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('first user message');
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('MUST');
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('Prefer "mcp__piggercode__change_title"');
  });

  it('documents attachment blocks so referenced files are read before answering', () => {
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('[attachments]');
    expect(PIGGERCODE_BASE_SYSTEM_PROMPT_V1).toContain('attachments block');
  });
});

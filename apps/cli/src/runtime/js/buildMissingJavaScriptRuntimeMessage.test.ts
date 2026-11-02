import { describe, expect, it } from 'vitest';

import { buildMissingJavaScriptRuntimeMessage } from './buildMissingJavaScriptRuntimeMessage';

describe('buildMissingJavaScriptRuntimeMessage', () => {
  it('includes the supported runtime override guidance', () => {
    expect(buildMissingJavaScriptRuntimeMessage('Claude Code')).toContain('PIGGERCODE_JS_RUNTIME_PATH');
    expect(buildMissingJavaScriptRuntimeMessage('Claude Code')).toContain('PIGGERCODE_MANAGED_NODE_BIN');
    expect(buildMissingJavaScriptRuntimeMessage('Claude Code')).toContain('PIGGERCODE_NODE_PATH');
  });
});

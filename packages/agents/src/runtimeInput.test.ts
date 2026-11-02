import { describe, expect, it } from 'vitest';

import * as agents from './index.js';
import { AGENTS_CORE } from './manifest.js';

describe('agent runtime input capability', () => {
  it('declares shared in-flight steer support in the manifest for steer-capable providers', () => {
    expect(Reflect.get(AGENTS_CORE.claude, 'runtimeInput')).toEqual({
      inFlightSteerSupported: true,
      terminalPromptInjectionSupported: true,
    });
  });

});

import { describe, expect, it } from 'vitest';

import * as agents from './index.js';
import { AGENTS_CORE } from './manifest.js';
import { AGENT_IDS } from './types.js';

describe('agent media capabilities', () => {
  it('defines media capability vocabulary for every canonical agent', () => {
    for (const agentId of AGENT_IDS) {
      expect(AGENTS_CORE[agentId].media).toBeDefined();
      expect(AGENTS_CORE[agentId].media.acceptsImageInput).toMatch(/^(supported|experimental|unsupported)$/);
      expect(AGENTS_CORE[agentId].media.emitsSessionMedia).toMatch(/^(supported|experimental|unsupported)$/);
      expect(AGENTS_CORE[agentId].media.nativeImageGeneration).toMatch(/^(supported|experimental|unsupported)$/);
    }
  });

});

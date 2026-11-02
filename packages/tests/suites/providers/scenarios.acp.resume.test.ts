import { describe, expect, it } from 'vitest';

import {
  makeAcpResumeFreshSessionImportsHistoryScenario,
  makeAcpResumeLoadSessionScenario,
} from '../../src/testkit/providers/scenarios/scenarios.acp';
import { acpResumeMetadataKey } from '../../src/testkit/providers/scenarios/scenarioCatalogSupport';
import { AGENT_IDS, AGENTS_CORE } from '@piggercode/agents';

describe('providers: ACP scenario builders (resume)', () => {

  it('derives resume metadata keys from the shared agent manifest', () => {
    for (const agentId of AGENT_IDS) {
      const resume = AGENTS_CORE[agentId].resume;
      const expected = 'vendorResumeIdField' in resume ? resume.vendorResumeIdField : null;
      if (!expected) continue;
      expect(acpResumeMetadataKey(agentId as any)).toBe(expected);
    }
  });
});

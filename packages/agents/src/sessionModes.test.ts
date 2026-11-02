import { describe, expect, it } from 'vitest';

import { AGENT_IDS } from './types.js';
import {
  AGENT_SESSION_MODE_DESCRIPTORS,
  AGENT_SESSION_MODES,
  getAgentSessionModeDescriptor,
  getAgentSessionModesKind,
} from './sessionModes.js';
import { getAgentAdvancedModeCapabilities } from './advancedModes.js';
import { BUILT_IN_ACP_CONFIG } from './acp.js';
import { resolveAgentNativeSpawnDefinitiveRejection } from './nativeLaunchSelection.js';


describe('sessionModes', () => {

  it('does not suppress negotiated modes for built-in ACP transports that allow them', () => {
    for (const config of Object.values(BUILT_IN_ACP_CONFIG)) {
      if (config.supportsModes === 'no') continue;
      expect(getAgentSessionModeDescriptor(config.agentId).source, config.agentId).toBe('acp');
      expect(getAgentSessionModesKind(config.agentId), config.agentId).not.toBe('none');
    }
  });

  it('keeps the structured descriptor defined for every canonical agent', () => {
    expect(Object.keys(AGENT_SESSION_MODE_DESCRIPTORS).sort()).toEqual([...AGENT_IDS].sort());
    expect(Object.keys(AGENT_SESSION_MODES).sort()).toEqual([...AGENT_IDS].sort());
    for (const agentId of AGENT_IDS) {
      expect(getAgentSessionModeDescriptor(agentId)).toBeDefined();
    }
  });
});

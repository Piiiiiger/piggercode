import { describe, expect, it } from 'vitest';

import { AGENT_IDS } from './types.js';
import { getAgentLocalCliConfig, AGENT_LOCAL_CLI_CONFIG } from './localCli.js';


describe('AGENT_LOCAL_CLI_CONFIG', () => {
  it('covers every built-in agent', () => {
    expect(Object.keys(AGENT_LOCAL_CLI_CONFIG).sort()).toEqual([...AGENT_IDS].sort());
  });

  it('keeps Claude login launch metadata centralized', () => {
    expect(getAgentLocalCliConfig('claude')).toMatchObject({
      detectKey: 'claude',
      machineLoginKey: 'claude-code',
      authSupport: 'login_terminal',
    });
  });

});

import { describe, expect, it } from 'vitest';

import { BUILT_IN_ACP_CONFIG } from './acp.js';
import { getAgentToolsCapability } from './tools.js';

describe('built-in ACP config', () => {
  /**
   * The runner resolves Happier/custom MCP servers only for `native_mcp` delivery, then the
   * ACP backend decides whether those descriptors ride `session/new`/`session/load`. An agent
   * that declares ACP pass-through while declaring shell-bridge delivery therefore reaches the
   * provider with an empty MCP map — the declaration promises tools the runner never resolves.
   */
  it('never declares ACP MCP pass-through for an agent whose tools delivery is not native MCP', () => {
    const inconsistent = Object.values(BUILT_IN_ACP_CONFIG)
      .filter((config) => config !== undefined && config.mcpServers !== 'drop')
      .filter((config) => getAgentToolsCapability(config.agentId).delivery !== 'native_mcp')
      .map((config) => config.agentId);
    expect(inconsistent).toEqual([]);
  });
});

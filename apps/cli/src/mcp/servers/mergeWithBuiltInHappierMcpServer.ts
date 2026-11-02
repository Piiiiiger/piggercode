import type { McpServerConfig } from '@/agent';

/**
 * Ensures the built-in `piggercode` MCP server is always present and wins collisions.
 */
export function mergeWithBuiltInHappierMcpServer(params: Readonly<{
  builtIn: Record<string, McpServerConfig>;
  extra: Record<string, McpServerConfig>;
}>): Record<string, McpServerConfig> {
  const { piggercode, ...restBuiltIn } = params.builtIn;
  const { piggercode: _ignoredUserServer, ...restExtra } = params.extra;
  return {
    ...restExtra,
    ...restBuiltIn,
    ...(piggercode ? { piggercode } : {}),
  };
}


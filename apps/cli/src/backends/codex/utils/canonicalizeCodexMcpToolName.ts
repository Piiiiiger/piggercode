const BUILTIN_PIGGERCODE_MCP_SERVER_PREFIX = 'mcp__piggercode__piggercode__';

export function canonicalizeCodexMcpToolName(toolName: string): string {
    const normalized = typeof toolName === 'string' ? toolName.trim() : '';
    if (!normalized) return normalized;
    if (!normalized.startsWith(BUILTIN_PIGGERCODE_MCP_SERVER_PREFIX)) return normalized;
    return `mcp__piggercode__${normalized.slice(BUILTIN_PIGGERCODE_MCP_SERVER_PREFIX.length)}`;
}

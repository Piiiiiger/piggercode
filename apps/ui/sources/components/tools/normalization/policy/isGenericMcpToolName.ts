import { knownTools } from '@/components/tools/catalog';

/**
 * Whether a tool is shown as a generic MCP call (puzzle icon, `MCP: Server Tool` title, collapsed to
 * its title). MCP tools with their own catalog entry, such as PiggerCode's remote command, read like
 * the tool they are instead.
 */
export function isGenericMcpToolName(toolName: string): boolean {
    return toolName.startsWith('mcp__') && !Object.prototype.hasOwnProperty.call(knownTools, toolName);
}

import * as z from 'zod';

import type { ToolCall } from '@/sync/domains/messages/messageTypes';
import { storage } from '@/sync/domains/state/storage';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { t } from '@/text';
import { ICON_TERMINAL } from '../icons';
import type { KnownToolDefinition } from '../_types';

/**
 * `machine.command.run` as agents call it: the `machine_command_run` tool of PiggerCode's own MCP
 * server. It is a shell command on another computer, so it reads like one instead of a generic
 * MCP call.
 */
export const MACHINE_COMMAND_RUN_TOOL_NAME = 'mcp__piggercode__machine_command_run';

function readInputString(tool: ToolCall, key: 'machineId' | 'command' | 'cwd'): string | null {
    const input = tool.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const value = (input as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readMachineCommandInput(tool: ToolCall): Readonly<{ command: string | null; cwd: string | null }> {
    return { command: readInputString(tool, 'command'), cwd: readInputString(tool, 'cwd') };
}

function resolveMachineName(tool: ToolCall): string | null {
    const machineId = readInputString(tool, 'machineId');
    if (!machineId) return null;
    const machine = storage.getState().machines[machineId];
    return machine ? getMachineDisplayName(machine) : null;
}

export const providerMachineCommandTools = {
    [MACHINE_COMMAND_RUN_TOOL_NAME]: {
        title: (opts: { tool: ToolCall }) => {
            const machine = resolveMachineName(opts.tool);
            return machine ? t('tools.machineCommand.titleOn', { machine }) : t('tools.machineCommand.title');
        },
        icon: ICON_TERMINAL,
        isMutable: true,
        input: z.object({
            machineId: z.string(),
            command: z.string(),
            cwd: z.string(),
        }).partial().passthrough(),
        extractSubtitle: (opts: { tool: ToolCall }) => readInputString(opts.tool, 'command'),
    },
} satisfies Record<string, KnownToolDefinition>;

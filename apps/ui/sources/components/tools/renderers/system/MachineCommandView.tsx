import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { MachineCommandRunResponseSchema, maybeParseJson, type MachineCommandRunResponse } from '@piggercode/protocol';
import { CommandView } from '@/components/sessions/transcript/CommandView';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import type { ToolViewProps } from '../core/_registry';
import { ToolSectionView } from '../../shell/presentation/ToolSectionView';
import { readMachineCommandInput } from '../../catalog/providers/machineCommand';
import { tailTextWithEllipsis } from '../../normalization/parse/stdStreams';

const MAX_PREVIEW_CHARS = 6000;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The text an MCP result carries: a string, `[{ type: 'text', text }]`, or `{ content: [...] }`. */
function readMcpResultText(result: unknown): string | null {
    const parsed = maybeParseJson(result);
    if (typeof parsed === 'string') return parsed;
    const blocks = Array.isArray(parsed) ? parsed : asRecord(parsed)?.content;
    if (!Array.isArray(blocks)) return null;
    const text = blocks
        .map((block) => {
            const entry = asRecord(block);
            return entry?.type === 'text' && typeof entry.text === 'string' ? entry.text : '';
        })
        .join('');
    return text.length > 0 ? text : null;
}

/** The machine's reply (`MachineCommandRunResponse`), whichever way the provider wrapped the MCP result. */
export function parseMachineCommandResult(result: unknown): MachineCommandRunResponse | null {
    const direct = MachineCommandRunResponseSchema.safeParse(asRecord(maybeParseJson(result)));
    if (direct.success) return direct.data;
    const text = readMcpResultText(result);
    if (!text) return null;
    const fromText = MachineCommandRunResponseSchema.safeParse(asRecord(maybeParseJson(text)));
    return fromText.success ? fromText.data : null;
}

export const MachineCommandView = React.memo<ToolViewProps>(({ tool, detailLevel }) => {
    const { command, cwd } = readMachineCommandInput(tool);
    const isFullView = detailLevel === 'full';
    const isDone = tool.state === 'completed' || tool.state === 'error';
    const response = isDone ? parseMachineCommandResult(tool.result) : null;
    const preview = (text: string | undefined) =>
        text ? (isFullView ? text : tailTextWithEllipsis(text, MAX_PREVIEW_CHARS)) : null;
    // A refusal (remote commands off, folder not allowed) or a failed call has no streams to show.
    const error = response?.error
        ?? (isDone && !response ? readMcpResultText(tool.result) : null);
    const exitCode = typeof response?.exitCode === 'number' && response.exitCode !== 0 ? response.exitCode : null;

    return (
        <ToolSectionView>
            {cwd ? <Text style={styles.cwd} numberOfLines={1}>{cwd}</Text> : null}
            <CommandView
                command={command ?? ''}
                stdout={preview(response?.stdout)}
                stderr={preview(response?.stderr)}
                error={error}
                hideEmptyOutput
                fullWidth={isFullView}
            />
            {exitCode !== null ? (
                <Text style={styles.exitCode}>{t('tools.machineCommand.exitCode', { code: exitCode })}</Text>
            ) : null}
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    cwd: {
        marginHorizontal: 12,
        marginBottom: 4,
        fontSize: 12,
        color: theme.colors.text.secondary,
    },
    exitCode: {
        marginTop: 6,
        marginHorizontal: 12,
        fontSize: 12,
        color: theme.colors.text.secondary,
    },
}));

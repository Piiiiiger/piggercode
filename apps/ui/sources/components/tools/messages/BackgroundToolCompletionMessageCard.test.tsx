import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { installToolShellPresentationCommonModuleMocks } from '../shell/presentation/toolShellPresentationTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installToolShellPresentationCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${JSON.stringify(params)})` : key),
        });
    },
});

describe('background tool completion notice', () => {
    it('renders the automated notice as one line naming the tool, not as a user message', async () => {
        const { findStructuredMessageRenderer } = await import('@/components/sessions/transcript/structured/structuredMessageRegistry');
        const entry = findStructuredMessageRenderer('background_tool_completion.v1');
        expect(entry).not.toBeNull();

        const parsed = entry!.schema.safeParse({
            v: 1,
            callId: 'call_1',
            toolName: 'mcp__piggercode__machine_command_run',
            status: 'completed',
            finishedAtMs: 42,
        });
        expect(parsed.success).toBe(true);

        const element = entry!.render(parsed.success ? parsed.data : (null as never), {
            sessionId: 's1',
            message: { kind: 'user-text', id: 'm1', localId: null, createdAt: 1, text: 'x' } as any,
            interaction: deriveTranscriptInteraction({ kind: 'public' }),
            onJumpToAnchor: () => {},
        });
        const screen = await renderScreen(element!);

        expect(screen.findByTestId('background-tool-completion:call_1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('tools.backgroundCompletion.finished');
        expect(screen.getTextContent()).toContain('tools.machineCommand.title');
    });
});

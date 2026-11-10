import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installAgentInputCommonModuleMocks } from '../agentInputTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const turnOutputTokens = vi.hoisted(() => ({ value: null as number | null, sinceMs: [] as Array<number | null> }));

installAgentInputCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSessionTurnOutputTokens: (_sessionId: string, sinceMs: number | null) => {
                turnOutputTokens.sinceMs.push(sinceMs);
                return turnOutputTokens.value;
            },
        });
    },
});

vi.mock('@/sync/runtime/time', () => ({ nowServerMs: () => 100_000 }));
vi.mock('@/hooks/ui/useReducedMotionPreference', () => ({ useReducedMotionPreference: () => true }));

describe('AgentInputWorkingStatus', () => {
    it('shows the verb, how long the turn has run and the tokens it generated', async () => {
        turnOutputTokens.value = 1_234;
        const { AgentInputWorkingStatus } = await import('./AgentInputWorkingStatus');
        const screen = await renderScreen(
            <AgentInputWorkingStatus sessionId="s1" startedAt={28_000} text="conjuring…" color="#999" />,
        );

        expect(screen.getTextContent()).toContain('✻');
        expect(screen.getTextContent()).toContain('Conjuring…');
        expect(screen.getTextContent()).toContain('(1m 12s · ↓ 1.2k tokens)');
        expect(turnOutputTokens.sinceMs.at(-1)).toBe(28_000);
    });

    it('shows only the verb until the turn start and token count are known', async () => {
        turnOutputTokens.value = null;
        const { AgentInputWorkingStatus } = await import('./AgentInputWorkingStatus');
        const screen = await renderScreen(
            <AgentInputWorkingStatus sessionId="s1" startedAt={null} text="conjuring…" color="#999" />,
        );

        expect(screen.getTextContent()).toContain('Conjuring…');
        expect(screen.getTextContent()).not.toContain('(');
    });
});

describe('working status formats', () => {
    it('formats elapsed time and token counts the way Claude Code does', async () => {
        const { formatWorkingElapsed, formatWorkingTokens } = await import('./AgentInputWorkingStatus');
        expect(formatWorkingElapsed(0)).toBe('0s');
        expect(formatWorkingElapsed(72_000)).toBe('1m 12s');
        expect(formatWorkingElapsed(3_780_000)).toBe('1h 3m');
        expect(formatWorkingTokens(999)).toBe('999');
        expect(formatWorkingTokens(1_000)).toBe('1k');
        expect(formatWorkingTokens(1_234)).toBe('1.2k');
        expect(formatWorkingTokens(123_456)).toBe('123k');
    });
});

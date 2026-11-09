import { describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { buildTerminalReopenOptions, sessionShowsTerminal } from './nativeTerminalSessions';

describe('buildTerminalReopenOptions', () => {
    it('reopens the conversation the session has, as a terminal', () => {
        const base = createSessionFixture();
        const codex = createSessionFixture({ metadata: { ...base.metadata!, flavor: 'codex', codexSessionId: 'thread-1' } });
        expect(buildTerminalReopenOptions({
            sessionId: 'session-1',
            session: codex,
            machineId: 'machine-1',
            directory: '/project',
            serverId: 'server-a',
        })).toEqual({
            sessionId: 'session-1',
            machineId: 'machine-1',
            directory: '/project',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            resume: 'thread-1',
            serverId: 'server-a',
            nativeTerminal: true,
        });

        const fresh = createSessionFixture({ metadata: { ...base.metadata!, flavor: 'claude' } });
        expect(buildTerminalReopenOptions({
            sessionId: 'session-1',
            session: fresh,
            machineId: 'machine-1',
            directory: '/project',
            serverId: null,
        })).toEqual({
            sessionId: 'session-1',
            machineId: 'machine-1',
            directory: '/project',
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
            nativeTerminal: true,
        });
    });
});

describe('sessionShowsTerminal', () => {
    it('keeps a stopped chat whose replay seed has not reached its first prompt a chat: only the chat runtime delivers it', () => {
        const base = createSessionFixture();
        const machine = { id: 'machine-1', metadata: { daemonNativeTerminalSessionsSupported: true } } as unknown as Parameters<typeof sessionShowsTerminal>[0]['machine'];
        const seeded = createSessionFixture({
            metadata: {
                ...base.metadata!,
                flavor: 'claude',
                replaySeedV1: { v: 1, seedText: 'Earlier conversation…', sourceSessionId: 'source-1', sourceCutoffSeqInclusive: 9, createdAtMs: 1 },
            },
        });
        expect(sessionShowsTerminal({ session: seeded, machine })).toBe(false);

        const applied = createSessionFixture({
            metadata: { ...seeded.metadata!, replaySeedV1: { ...seeded.metadata!.replaySeedV1!, appliedToLocalId: 'local-1', appliedAtMs: 2 } },
        });
        expect(sessionShowsTerminal({ session: applied, machine })).toBe(true);
    });
});

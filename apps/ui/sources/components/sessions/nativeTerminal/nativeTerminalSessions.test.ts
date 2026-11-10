import { describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { buildTerminalReopenOptions } from './nativeTerminalSessions';

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
        });
    });
});

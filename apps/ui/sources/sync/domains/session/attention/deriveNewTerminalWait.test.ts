import { describe, expect, it } from 'vitest';

import { deriveNewTerminalWait } from './deriveNewTerminalWait';

describe('deriveNewTerminalWait', () => {
    it('reports a wait the terminal started, once', () => {
        const waiting = { terminalWaiting: { on: 'permission', since: 10 } };
        expect(deriveNewTerminalWait({}, waiting)).toEqual({ on: 'permission', since: 10 });
        expect(deriveNewTerminalWait(waiting, waiting)).toBeNull();
        expect(deriveNewTerminalWait(waiting, { terminalWaiting: { on: 'permission', since: 20 } })).toEqual({ on: 'permission', since: 20 });
        expect(deriveNewTerminalWait(waiting, { terminalWaiting: { on: 'exited', exitCode: 1, since: 30 } }))
            .toEqual({ on: 'exited', exitCode: 1, since: 30 });
    });

    it('reports nothing when the terminal stops waiting or the state says nothing readable', () => {
        expect(deriveNewTerminalWait({ terminalWaiting: { on: 'question', since: 10 } }, { terminalWaiting: null })).toBeNull();
        expect(deriveNewTerminalWait(null, { requests: {} })).toBeNull();
        expect(deriveNewTerminalWait(null, { terminalWaiting: { on: 'something new', since: 1 } })).toBeNull();
    });
});

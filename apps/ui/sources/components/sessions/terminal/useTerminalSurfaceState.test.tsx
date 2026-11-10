import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import type { EmbeddedTerminalRendererHandle } from './embeddedTerminalRendererHandle';
import { useTerminalSurfaceState } from './useTerminalSurfaceState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The xterm view is the boundary: a fake renderer records what reaches the screen.
function fakeRenderer() {
    return { write: vi.fn((_data: string) => {}), clear: vi.fn(() => {}), reset: vi.fn(() => {}) };
}

async function mountSurface(terminalKey: string, renderer: EmbeddedTerminalRendererHandle, options: Readonly<{ wholeScreenOnly?: boolean }> = {}) {
    const params = {
        ...options,
        terminalKey,
        terminalRef: { current: renderer },
        terminalIdRef: { current: 'terminal-1' as string | null },
        cursorRef: { current: 0 },
        terminalRendererHandleRef: { current: null as EmbeddedTerminalRendererHandle | null },
        clearNonceRef: { current: 0 },
    };
    return await renderHook(() => useTerminalSurfaceState(params));
}

describe('useTerminalSurfaceState', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('keeps adding output to the screen without wiping it once a terminal has printed more than the kept output', async () => {
        const key = 'session-attach:long-running';
        const writer = fakeRenderer();
        const writerHook = await mountSurface(key, writer);
        // A second view of the same terminal follows the first one's output.
        const follower = fakeRenderer();
        await mountSurface(key, follower);

        // A full-screen CLI prints far more than the 64,000 characters kept for re-showing the terminal.
        for (let i = 0; i < 3; i += 1) writerHook.getCurrent().writeTerminalOutput('x'.repeat(30_000));
        writer.write.mockClear();
        writer.clear.mockClear();
        follower.write.mockClear();
        follower.clear.mockClear();

        writerHook.getCurrent().writeTerminalOutput('\x1b[27;1H●');

        expect(writer.clear).not.toHaveBeenCalled();
        expect(writer.write.mock.calls).toEqual([['\x1b[27;1H●']]);
        expect(follower.clear).not.toHaveBeenCalled();
        expect(follower.write.mock.calls).toEqual([['\x1b[27;1H●']]);
    });

    it('shows a chunk longer than the kept output whole in the view that reads it', async () => {
        const writer = fakeRenderer();
        const writerHook = await mountSurface('session-attach:huge-chunk', writer);
        writerHook.getCurrent().writeTerminalOutput('$ ');
        writer.write.mockClear();
        writer.clear.mockClear();

        const chunk = 'y'.repeat(70_000);
        writerHook.getCurrent().writeTerminalOutput(chunk);

        expect(writer.clear).not.toHaveBeenCalled();
        expect(writer.write.mock.calls).toEqual([[chunk]]);
    });
    it('shows a reopened view its history without the clipboard copies in it, which already happened', async () => {
        const key = 'session-attach:copies';
        const writer = fakeRenderer();
        const writerHook = await mountSurface(key, writer, { wholeScreenOnly: true });
        const output = 'before \x1b]52;c;QUFB\x07after';
        writerHook.getCurrent().writeTerminalOutput(output);
        // The view the copy happens in writes it as it arrives.
        expect(writer.write.mock.calls).toContainEqual([output]);

        // Reopened later (after the user copied something else): replaying copy A must not overwrite the clipboard.
        const reopened = fakeRenderer();
        const reopenedHook = await mountSurface(key, reopened, { wholeScreenOnly: true });
        reopened.write.mockClear();
        reopenedHook.getCurrent().hydrateTerminalRendererIfNeeded();
        expect(reopened.write.mock.calls.map(([data]) => data).join('')).toBe('before after');
    });

    it('gives a new view of a full-screen program its output only from the start, never just the end of it', async () => {
        const key = 'session-attach:reopened-view';
        const reader = fakeRenderer();
        const readerHook = await mountSurface(key, reader, { wholeScreenOnly: true });
        readerHook.getCurrent().writeTerminalOutput('a'.repeat(40_000));

        // Everything is still kept: a view opened now shows it all.
        const early = fakeRenderer();
        const earlyHook = await mountSurface(key, early, { wholeScreenOnly: true });
        early.write.mockClear();
        earlyHook.getCurrent().hydrateTerminalRendererIfNeeded();
        expect(early.write.mock.calls.map(([data]) => data).join('')).toBe('a'.repeat(40_000));
        expect(earlyHook.getCurrent().isScreenWhole()).toBe(true);

        // More than is kept: a view opened now is given nothing rather than the end alone.
        readerHook.getCurrent().writeTerminalOutput('b'.repeat(40_000));
        const late = fakeRenderer();
        const lateHook = await mountSurface(key, late, { wholeScreenOnly: true });
        late.write.mockClear();
        lateHook.getCurrent().hydrateTerminalRendererIfNeeded();
        expect(late.write).not.toHaveBeenCalled();
        expect(lateHook.getCurrent().isScreenWhole()).toBe(false);

        // Attached afresh: the view starts again from the new output's start.
        lateHook.getCurrent().clearTerminalOutput();
        expect(lateHook.getCurrent().isScreenWhole()).toBe(true);
    });
});

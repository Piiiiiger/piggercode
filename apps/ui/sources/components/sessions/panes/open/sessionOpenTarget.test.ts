import { describe, expect, it, vi } from 'vitest';

import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/components/sessions/terminal/embeddedTerminalDocking', () => ({
    createSessionDetailsTerminalTab: () => ({ key: 'terminal', kind: 'terminal', title: 'Terminal', resource: { kind: 'terminal' } }),
    SESSION_DETAILS_TERMINAL_TAB_KEY: 'terminal',
}));

const {
    canLayoutDockSessionPane,
    canLayoutHostSessionPane,
    resolveSessionOpenPlacement,
} = await import('./sessionOpenTarget');

const PHONE = { containerWidthPx: 390, deviceType: 'phone', multiPaneEnabled: true } as const;
const DESKTOP = { containerWidthPx: 1400, deviceType: 'tablet', multiPaneEnabled: true } as const;
/** A wide window with panes switched off — a desktop that `deviceType === 'phone'` gets wrong. */
const PANES_OFF = { containerWidthPx: 1400, deviceType: 'tablet', multiPaneEnabled: false } as const;

function makeSubagent(overrides: Partial<SessionSubagent> = {}): SessionSubagent {
    return {
        id: 'sub_1',
        kind: 'subagent_sidechain',
        status: 'running',
        display: { title: 'Reviewer' },
        transcript: { toolMessageRouteId: 'msg_1', sidechainId: 'sc_1' },
        recipient: null,
        capabilities: {
            canOpen: true,
            canSend: false,
            canStop: false,
            canLaunchChild: false,
            canDelete: false,
            canOpenAdvancedRun: false,
        },
        timestamps: {},
        ...overrides,
    } satisfies SessionSubagent;
}

/**
 * ONE decision, asked by every session surface: is there room for a pane, or must this become a
 * screen? Before the extraction the transcript's file links, the header's agents button and the
 * Agents pane each answered it in their own words, and the answers disagreed — which is why a
 * narrow-tablet case appears here beside the phone one.
 */
describe('resolveSessionOpenPlacement', () => {
    it('opens a details tab where a details pane fits, and a full screen where it does not', () => {
        expect(resolveSessionOpenPlacement({
            sessionId: 's1',
            target: { kind: 'file', path: 'src/api.ts' },
            layout: DESKTOP,
        })).toEqual({
            kind: 'detailsTab',
            tab: expect.objectContaining({ key: 'file:src/api.ts', kind: 'file' }),
        });

        expect(resolveSessionOpenPlacement({
            sessionId: 's1',
            target: { kind: 'file', path: 'src/api.ts' },
            layout: PHONE,
        })).toEqual({ kind: 'route', href: '/session/s1/file?path=src%2Fapi.ts' });
    });

    it('opens the sidebar terminal in the right pane where one exists, and as its screen where it cannot', () => {
        expect(resolveSessionOpenPlacement({
            sessionId: 's1',
            target: { kind: 'terminal' },
            layout: DESKTOP,
        })).toEqual({ kind: 'rightTab', tabId: 'terminal' });

        // The same dead control one button over from the agents glyph: the header terminal button
        // forces the `sidebar` dock location on a phone, and the sidebar IS the right pane.
        expect(resolveSessionOpenPlacement({
            sessionId: 's1',
            serverId: 'srv_2',
            target: { kind: 'terminal' },
            layout: PHONE,
        })).toEqual({ kind: 'route', href: '/session/s1/terminal?serverId=srv_2' });
    });
});

/**
 * The return direction. `/file` and `/commit` used to ask this with their own copies of the pane
 * minimums and a raw `useDeviceType()`, which is how a route could refuse to hand back to a pane the
 * host would have drawn. One set of numbers, one normalization, two directions.
 */
describe('canLayoutDockSessionPane', () => {
    it('hands back to a docked pane only where one actually fits beside the transcript', () => {
        expect(canLayoutDockSessionPane(DESKTOP, 'details')).toBe(true);
        expect(canLayoutDockSessionPane(DESKTOP, 'right')).toBe(true);
        expect(canLayoutDockSessionPane(PANES_OFF, 'details')).toBe(false);
        expect(canLayoutDockSessionPane(PHONE, 'details')).toBe(false);
    });

    it('keeps the dedicated screen when the pane could only be an overlay', () => {
        const NARROW_TABLET = { containerWidthPx: 800, deviceType: 'tablet', multiPaneEnabled: true } as const;

        // Wide enough for a pane to exist at all — that is what the OPEN direction asks, and it says
        // yes. Not wide enough for the details pane to be docked once the sidebar is also open, so
        // the handback says no and the route stays. The two answers differ on purpose.
        expect(canLayoutHostSessionPane(NARROW_TABLET, 'details')).toBe(true);
        expect(canLayoutDockSessionPane(NARROW_TABLET, 'details')).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import {
    resolveSessionCockpitRouteFromPathname,
    resolveSessionMobileSurfaceIntent,
    resolveSessionRightTabIdForSurface,
    resolveSessionRoutePathForSurface,
} from './sessionCockpitState';

describe('sessionCockpitState', () => {
    it('maps legacy fullscreen subroutes to cockpit surfaces', () => {
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'files' })).toBe('browse');
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'git' })).toBe('git');
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'details' })).toBe('tabs');
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'terminal', terminalTabAvailable: true })).toBe('terminal');
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'terminal', terminalTabAvailable: false })).toBe('chat');
    });

    it('lets persisted mobile surface state override the default chat fallback', () => {
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'index', persistedSurface: 'tabs' })).toBe('tabs');
        expect(resolveSessionMobileSurfaceIntent({ routeKind: 'index', persistedSurface: 'browse' })).toBe('browse');
        expect(
            resolveSessionMobileSurfaceIntent({
                routeKind: 'index',
                activeRightTabId: 'terminal',
                persistedSurface: 'chat',
                terminalTabAvailable: true,
            }),
        ).toBe('chat');
    });

    it('falls back to chat when the persisted terminal surface is unavailable', () => {
        expect(
            resolveSessionMobileSurfaceIntent({
                routeKind: 'index',
                persistedSurface: 'terminal',
                terminalTabAvailable: false,
                detailsTargetPresent: true,
                activeRightTabId: 'files',
            }),
        ).toBe('chat');
    });

    it('falls back away from the terminal surface in route parsing when the terminal tab is unavailable', () => {
        expect(
            resolveSessionCockpitRouteFromPathname('/session/session-1/terminal', null, false),
        ).toEqual({
            sessionId: 'session-1',
            surface: 'chat',
        });
    });

    it('keeps cockpit routing active for nested legacy surface paths', () => {
        expect(resolveSessionCockpitRouteFromPathname('/session/session-1/files/browse')).toEqual({
            sessionId: 'session-1',
            surface: 'browse',
        });
        expect(resolveSessionCockpitRouteFromPathname('/session/session-1/git/diff')).toEqual({
            sessionId: 'session-1',
            surface: 'git',
        });
        expect(resolveSessionCockpitRouteFromPathname('/session/session-1/details/files')).toEqual({
            sessionId: 'session-1',
            surface: 'tabs',
        });
    });

});

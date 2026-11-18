import { describe, expect, it, vi } from 'vitest';

import { HappyError } from '@/utils/errors/errors';

import { loadSessionForDelete } from './loadSessionForDelete';

/** The store as the helper reads it: which sessions are loaded, and which of those carry a readable link. */
function deps(params: Readonly<{
    loaded?: readonly string[];
    readableLinks?: readonly string[];
    loadable?: Readonly<Record<string, 'with-link' | 'without-link'>>;
}>) {
    const loaded = new Set(params.loaded ?? []);
    const readableLinks = new Set(params.readableLinks ?? []);
    return {
        isLoaded: (sessionId: string) => loaded.has(sessionId),
        isLinkReadable: (sessionId: string) => readableLinks.has(sessionId),
        load: vi.fn(async (sessionId: string) => {
            const outcome = params.loadable?.[sessionId];
            if (!outcome) return;
            loaded.add(sessionId);
            if (outcome === 'with-link') readableLinks.add(sessionId);
        }),
    };
}

describe('loadSessionForDelete', () => {
    it('loads a listed session this device lacks before it is deleted', async () => {
        const d = deps({ loadable: { s1: 'without-link' } });

        await loadSessionForDelete({ sessionId: 's1', serverId: 'server-a', linked: false }, d);

        expect(d.load).toHaveBeenCalledWith('s1', 'server-a');
    });

    it('leaves a loaded session as it is', async () => {
        const d = deps({ loaded: ['s1'] });

        await loadSessionForDelete({ sessionId: 's1', serverId: 'server-a', linked: false }, d);

        expect(d.load).not.toHaveBeenCalled();
    });

    it('lets a session that is not linked go ahead when it could not be loaded, as the single Delete does', async () => {
        const d = deps({});

        await expect(loadSessionForDelete({ sessionId: 'plain', serverId: null, linked: false }, d)).resolves.toBeUndefined();
        expect(d.load).toHaveBeenCalledWith('plain', null);
    });

    it('deletes a linked session once its link reads from the loaded session', async () => {
        const d = deps({ loadable: { linked: 'with-link' } });

        await expect(loadSessionForDelete({ sessionId: 'linked', serverId: 'server-a', linked: true }, d)).resolves.toBeUndefined();
    });

    it('refuses a linked session that could not be loaded, whose machine copy would stay behind, saying why', async () => {
        const d = deps({});

        // A HappyError: the single Delete shows its message, the selection bar keeps it as the reason.
        await expect(loadSessionForDelete({ sessionId: 'linked', serverId: 'server-b', linked: true }, d)).rejects.toBeInstanceOf(HappyError);
    });

    it('refuses a linked session whose loaded record carries no readable link', async () => {
        const loadedWithoutLink = deps({ loaded: ['linked'] });
        const loadsWithoutLink = deps({ loadable: { linked: 'without-link' } });

        await expect(loadSessionForDelete({ sessionId: 'linked', serverId: 'server-a', linked: true }, loadedWithoutLink)).rejects.toThrow();
        await expect(loadSessionForDelete({ sessionId: 'linked', serverId: 'server-a', linked: true }, loadsWithoutLink)).rejects.toThrow();
    });
});

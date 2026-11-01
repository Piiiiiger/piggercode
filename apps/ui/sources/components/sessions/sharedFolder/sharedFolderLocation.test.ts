import { describe, expect, it } from 'vitest';

import { resolveSharedFolderLocation } from './sharedFolderLocation';

describe('resolveSharedFolderLocation', () => {
    it('places ~ in the home folder of the session machine', () => {
        expect(resolveSharedFolderLocation({ sharedFolderPath: '~/Downloads', homeDir: '/home/u' })).toEqual({
            absolutePath: '/home/u/Downloads',
            displayPath: '~/Downloads',
        });
    });

    it('uses an absolute folder as it is', () => {
        expect(resolveSharedFolderLocation({ sharedFolderPath: ' /srv/share/ ', homeDir: null })).toEqual({
            absolutePath: '/srv/share',
            displayPath: '/srv/share',
        });
    });

    it('cannot place ~ without the machine home folder', () => {
        expect(resolveSharedFolderLocation({ sharedFolderPath: '~/Downloads', homeDir: null })).toBeNull();
        expect(resolveSharedFolderLocation({ sharedFolderPath: 'Downloads', homeDir: '/home/u' })).toBeNull();
    });
});

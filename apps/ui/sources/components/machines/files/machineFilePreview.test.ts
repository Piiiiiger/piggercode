import { describe, expect, it } from 'vitest';

import { isMachineFilePreviewBinaryByName, resolveMachineFilePreview } from './machineFilePreview';

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('resolveMachineFilePreview', () => {
    it('shows text as text, a picture as an image, an SVG as its text and other bytes as binary', () => {
        expect(resolveMachineFilePreview('/home/u/README.md', base64('# Hello\n'))).toEqual({ kind: 'text', text: '# Hello\n' });
        expect(resolveMachineFilePreview('/home/u/logo.png', 'iVBORw0KGgo=')).toEqual({ kind: 'image', uri: 'data:image/png;base64,iVBORw0KGgo=' });
        expect(resolveMachineFilePreview('/home/u/icon.svg', base64('<svg/>'))).toEqual({ kind: 'text', text: '<svg/>' });
        expect(resolveMachineFilePreview('/home/u/blob', base64('a\u0000b'))).toEqual({ kind: 'binary' });
    });

    it('knows binary types by name before reading them, but still reads pictures and text', () => {
        expect(isMachineFilePreviewBinaryByName('/home/u/archive.zip')).toBe(true);
        expect(isMachineFilePreviewBinaryByName('/home/u/logo.png')).toBe(false);
        expect(isMachineFilePreviewBinaryByName('/home/u/main.ts')).toBe(false);
    });
});

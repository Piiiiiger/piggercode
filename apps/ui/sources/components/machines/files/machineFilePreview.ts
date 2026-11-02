import { decodeUtf8Base64 } from '@/scm/diff/fallbackUnifiedDiff';
import { getImageMimeTypeFromPath, isBinaryContent, isKnownBinaryPath } from '@/scm/utils/filePresentation';

export type MachineFilePreview =
    | Readonly<{ kind: 'text'; text: string }>
    | Readonly<{ kind: 'image'; uri: string }>
    | Readonly<{ kind: 'binary' }>;

/** An image shows as a picture (an SVG as its text); the session file view uses the same binary rules. */
function previewImageMime(path: string): string | null {
    const mime = getImageMimeTypeFromPath(path);
    return mime && mime !== 'image/svg+xml' ? mime : null;
}

/** Whether a preview can skip reading the file: a known binary type that is not a picture. */
export function isMachineFilePreviewBinaryByName(path: string): boolean {
    return isKnownBinaryPath(path) && previewImageMime(path) === null;
}

/** What a file's bytes show as: text, a picture, or neither. */
export function resolveMachineFilePreview(path: string, contentBase64: string): MachineFilePreview {
    const imageMime = previewImageMime(path);
    if (imageMime) return { kind: 'image', uri: `data:${imageMime};base64,${contentBase64}` };
    if (isKnownBinaryPath(path)) return { kind: 'binary' };
    const text = decodeUtf8Base64(contentBase64);
    return isBinaryContent(text) ? { kind: 'binary' } : { kind: 'text', text };
}

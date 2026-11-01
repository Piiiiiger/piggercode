import { extname } from 'node:path';

// File systems cap a name at 255 bytes; this leaves room for an upload prefix or a " (n)" suffix.
const MAX_SAFE_FILE_NAME_BYTES = 200;

/** Drops leading characters until the UTF-8 form fits, so the extension survives. */
function keepTailWithinUtf8Bytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    const characters = Array.from(value);
    let bytes = 0;
    let start = characters.length;
    while (start > 0) {
        const size = Buffer.byteLength(characters[start - 1]!, 'utf8');
        if (bytes + size > maxBytes) break;
        bytes += size;
        start -= 1;
    }
    return characters.slice(start).join('');
}

export function sanitizeSessionMediaFileName(value: string, fallback = 'file'): string {
    const raw = String(value ?? '');
    const base = raw.split(/[/\\]/g).pop() ?? '';
    const trimmed = base.trim() || fallback;
    // Letters and digits of any script stay (so 报告.pdf keeps its name); punctuation that shells or
    // file systems treat specially becomes "_".
    const safe = trimmed.replace(/[^\p{L}\p{M}\p{N}_.\- ()]/gu, '_');
    const collapsed = safe.replace(/_+/g, '_');
    const finalName = collapsed === '.' || collapsed === '..' ? fallback : collapsed;
    return keepTailWithinUtf8Bytes(finalName, MAX_SAFE_FILE_NAME_BYTES);
}

export function normalizeSessionMediaPathSegment(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === '.' || trimmed === '..') return null;
    if (trimmed.includes('\0')) return null;
    if (trimmed.includes('/') || trimmed.includes('\\')) return null;
    return trimmed;
}

export function withSessionMediaFileExtension(fileName: string, extensionWithDot: string): string {
    const safeExtension = extensionWithDot.startsWith('.') ? extensionWithDot : `.${extensionWithDot}`;
    const currentExtension = extname(fileName);
    const base = currentExtension ? fileName.slice(0, -currentExtension.length) : fileName;
    return `${base || 'file'}${safeExtension}`;
}

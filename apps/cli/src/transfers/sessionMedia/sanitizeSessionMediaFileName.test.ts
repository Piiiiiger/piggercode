import { describe, expect, it } from 'vitest';

import { sanitizeSessionMediaFileName } from './sanitizeSessionMediaFileName';

describe('sanitizeSessionMediaFileName', () => {
    it('keeps letters and digits from any script', () => {
        expect(sanitizeSessionMediaFileName('季度报告 2026.pdf')).toBe('季度报告 2026.pdf');
        expect(sanitizeSessionMediaFileName('Résumé – final.docx')).toBe('Résumé _ final.docx');
    });

    it('caps long names by UTF-8 bytes and keeps the extension', () => {
        const name = sanitizeSessionMediaFileName(`${'报'.repeat(150)}.pdf`);
        expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(200);
        expect(Buffer.byteLength(name, 'utf8')).toBeGreaterThan(195);
        expect(name.endsWith('报.pdf')).toBe(true);
    });
});

import { describe, expect, it } from 'vitest';

import { withKeepBothSuffix } from './keepBothFileName';

describe('withKeepBothSuffix', () => {
    it('numbers the name in front of its extension', () => {
        expect(withKeepBothSuffix('report.pdf', 1)).toBe('report (1).pdf');
        expect(withKeepBothSuffix('季度报告.txt', 2)).toBe('季度报告 (2).txt');
    });

    it('numbers dotfiles and names without an extension at the end', () => {
        expect(withKeepBothSuffix('.bashrc', 1)).toBe('.bashrc (1)');
        expect(withKeepBothSuffix('Makefile', 3)).toBe('Makefile (3)');
    });
});

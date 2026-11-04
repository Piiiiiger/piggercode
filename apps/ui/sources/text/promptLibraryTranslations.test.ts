import { describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { zhHans } from './translations/zh-Hans';
import type { TranslationStructure } from './_types';

describe('prompt library translation keys', () => {
    it('ships the duplicate key in every locale', () => {
        const locales: ReadonlyArray<TranslationStructure> = [en, zhHans];
        for (const locale of locales) {
            expect(locale.common.duplicate).toEqual(expect.any(String));
            expect(locale.common.duplicate.trim().length).toBeGreaterThan(0);
        }
    });
});

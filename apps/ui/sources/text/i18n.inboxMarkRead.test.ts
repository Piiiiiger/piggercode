import { describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { zhHans } from './translations/zh-Hans';
import {
    flattenTranslationLeaves,
    type TranslationLeaf,
} from '../../tools/i18n/translationAudit';

// The Inbox's review actions and popover entry affordance must be reachable by name in
// every shipped locale, without silently falling back to English.
const INBOX_MARK_READ_KEYS = [
    'inbox.markAllRead',
    'inbox.openInbox',
    'sessionInfo.markSessionRead',
] as const;
const INBOX_SECTION_KEYS = ['inbox.errors'] as const;

const CANONICAL_LOCALES = [
    { code: 'en', root: en },
    { code: 'zh-Hans', root: zhHans },
] as const;

function stringLeavesByLocale(root: unknown): Map<string, Extract<TranslationLeaf, { kind: 'string' }>> {
    const leaves = new Map<string, Extract<TranslationLeaf, { kind: 'string' }>>();
    for (const leaf of flattenTranslationLeaves(root)) {
        if (leaf.kind === 'string') leaves.set(leaf.key, leaf);
    }
    return leaves;
}

describe('Inbox mark-read i18n coverage', () => {
    const englishLeaves = stringLeavesByLocale(en);

    it('defines the Inbox action and section keys as strings in every canonical locale', () => {
        for (const locale of CANONICAL_LOCALES) {
            const leaves = stringLeavesByLocale(locale.root);
            for (const key of [...INBOX_MARK_READ_KEYS, ...INBOX_SECTION_KEYS]) {
                const leaf = leaves.get(key);
                expect(
                    leaf,
                    `${locale.code} is missing the ${key} string`,
                ).toBeDefined();
                expect(
                    leaf?.value.trim(),
                    `${locale.code} ships an empty ${key}`,
                ).not.toBe('');
            }
        }
    });

    it('never falls back to the English mark-all/mark-read copy outside en', () => {
        for (const key of INBOX_MARK_READ_KEYS) {
            const english = englishLeaves.get(key);
            expect(english?.kind).toBe('string');
            for (const locale of CANONICAL_LOCALES) {
                if (locale.code === 'en') continue;
                const leaves = stringLeavesByLocale(locale.root);
                expect(leaves.get(key)?.value).not.toBe(english?.value);
            }
        }
    });
});

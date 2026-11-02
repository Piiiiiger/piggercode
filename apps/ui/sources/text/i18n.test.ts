import Constants from 'expo-constants';
import { afterEach, describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { ru } from './translations/ru';
import { hasTranslation, setPreferredLanguageFromSettings, t, tLoose } from './i18n';

describe('text/i18n', () => {
    afterEach(() => {
        setPreferredLanguageFromSettings(null);
    });

    it('translates the default language and nested function entries', () => {
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(en.promptLibrary.profileStacksSubtitle({ count: 2 }));
        expect(tLoose('tabs.inbox')).toBe(en.tabs.inbox);
    });

    it('uses the Antigravity product name for the agy backend', () => {
        expect(en.settingsProviders.plugins.agy.title).toBe('Antigravity');
        expect(en.agentInput.agent.agy).toBe('Antigravity');
        expect(en.profiles.aiBackend.agySubtitleExperimental).toBe('Antigravity CLI (experimental)');
    });

    it('reports missing keys without throwing', () => {
        expect(hasTranslation('tabs.inbox')).toBe(true);
        expect(hasTranslation('not.a.real.key')).toBe(false);
        expect(tLoose('not.a.real.key')).toBe('not.a.real.key');
    });

    it('resolves a non-default preferred language and returns to the default when it is cleared', () => {
        // Locale trees are materialized lazily, so a preferred language that is not the default is
        // the case that proves the right tree is reachable rather than silently falling back to `en`.
        expect(ru.tabs.inbox).not.toBe(en.tabs.inbox);

        setPreferredLanguageFromSettings('ru');
        expect(t('tabs.inbox')).toBe(ru.tabs.inbox);
        expect(t('promptLibrary.profileStacksSubtitle', { count: 2 })).toBe(
            ru.promptLibrary.profileStacksSubtitle({ count: 2 }),
        );

        setPreferredLanguageFromSettings(null);
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
    });

    it('shows the product name configured for the build in translated text', () => {
        const extra = Constants.expoConfig!.extra as Record<string, unknown>;
        extra.app = { productName: 'Pigger', cliCommandName: 'piggercode' };
        try {
            expect(t('appCrash.subtitle')).toBe(
                'Pigger hit an unexpected error. You can restart the app UI or copy details for support.',
            );
            expect(t('settingsVoice.mode.happier')).toBe('Happier Voice');
            expect(t('sessionInfo.resumeCommand', { sessionId: 'abc' })).toBe('piggercode resume abc');
            setPreferredLanguageFromSettings('zh-Hans');
            expect(t('appCrash.subtitle')).toMatch(/^Pigger 发生了意外错误/);
        } finally {
            delete extra.app;
        }
        setPreferredLanguageFromSettings(null);
        expect(t('appCrash.subtitle')).toBe(en.appCrash.subtitle);
    });

    it('keeps names passed into translated text as they are', () => {
        const extra = Constants.expoConfig!.extra as Record<string, unknown>;
        extra.app = { productName: 'Pigger', cliCommandName: 'piggercode' };
        try {
            // A folder or session named after the upstream project keeps its name; the template's own words change.
            expect(t('sessionsList.explorerFolderA11y', { name: 'happier', count: 2 })).toBe('Folder happier, 2 sessions');
            expect(t('sessionInfo.resumeCommand', { sessionId: 'happier' })).toBe('piggercode resume happier');
            expect(t('sessionsList.explorerNewSessionA11y', { name: 'Happier docs' })).toBe('New session in Happier docs');
        } finally {
            delete extra.app;
        }
    });

    it('ignores an unsupported preferred language instead of losing translations', () => {
        setPreferredLanguageFromSettings('kl');
        expect(t('tabs.inbox')).toBe(en.tabs.inbox);
    });
});

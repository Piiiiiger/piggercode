import { afterEach, expect, it, vi } from 'vitest';

vi.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

import { setPreferredLanguageFromSettings } from '@/text';
import { performAndroidFileAction } from './nativeFileActions';

afterEach(() => setPreferredLanguageFromSettings(null));

it('reports unavailable native file actions in the selected language', async () => {
    const failure = () => performAndroidFileAction({ fileUri: 'file:///cache/clip.mp4', name: 'clip.mp4', action: 'save' })
        .then(() => null, (error: unknown) => error);
    setPreferredLanguageFromSettings('en');
    const english = await failure();
    setPreferredLanguageFromSettings('zh-Hans');
    const chinese = await failure();
    expect(english).toBeInstanceOf(Error);
    expect(chinese).toBeInstanceOf(Error);
    if (!(english instanceof Error) || !(chinese instanceof Error)) throw new Error('Expected unavailable action errors');
    expect(chinese.message).not.toBe(english.message);
});

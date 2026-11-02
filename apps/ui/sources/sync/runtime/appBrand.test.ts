import Constants from 'expo-constants';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveConfiguredRepositoryUrl } from './appBrand';

function setRepositoryUrl(repositoryUrl: unknown): void {
    (Constants.expoConfig!.extra as Record<string, unknown>).app = { repositoryUrl };
}

describe('resolveConfiguredRepositoryUrl', () => {
    afterEach(() => {
        delete (Constants.expoConfig!.extra as Record<string, unknown>).app;
    });

    it('returns the https repository the build names', () => {
        setRepositoryUrl('https://github.com/Piiiiiger/piggercode/');

        expect(resolveConfiguredRepositoryUrl()).toBe('https://github.com/Piiiiiger/piggercode');
    });

    it('has none when the build names none or a non-https link', () => {
        expect(resolveConfiguredRepositoryUrl()).toBeNull();

        setRepositoryUrl('http://github.com/Piiiiiger/piggercode');
        expect(resolveConfiguredRepositoryUrl()).toBeNull();

        setRepositoryUrl('not a url');
        expect(resolveConfiguredRepositoryUrl()).toBeNull();
    });
});

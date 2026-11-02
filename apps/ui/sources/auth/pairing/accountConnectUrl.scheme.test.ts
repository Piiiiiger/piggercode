import { describe, expect, it, vi } from 'vitest';

describe('accountConnectUrl scheme override', () => {
    it('builds with the configured scheme and parses first-party Happier schemes', async () => {
        vi.resetModules();
        vi.doMock('expo-constants', () => ({
            default: {
                expoConfig: {
                    scheme: 'piggercode-dev',
                },
            },
        }));

        const {
            buildAccountConnectDeepLink,
            buildAccountConnectRoutePath,
            parseAccountConnectDeepLink,
        } = await import('./accountConnectUrl');

        expect(buildAccountConnectDeepLink({ publicKeyB64Url: 'abc123' })).toBe('piggercode-dev:///account?abc123');
        expect(buildAccountConnectRoutePath({ publicKeyB64Url: 'abc+123/=' })).toBe(
            '/account?accountConnectKey=abc%2B123%2F%3D',
        );
        expect(parseAccountConnectDeepLink('piggercode-dev:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('piggercode:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('happier:account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('piggercode-internaldev:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('happier-custom:///account?abc123')).toEqual({ publicKeyB64Url: 'abc123' });
        expect(parseAccountConnectDeepLink('otherapp:///account?abc123')).toBeNull();

        const modern = { publicKeyB64Url: 'abc123', supportsCredentialVariants: true };
        const modernLink = buildAccountConnectDeepLink(modern);
        expect(modernLink).toBe('piggercode-dev:///account?abc123#supportsCredentialVariants=1');
        expect(parseAccountConnectDeepLink(modernLink)).toEqual(modern);
        expect(buildAccountConnectRoutePath(modern)).toBe('/account?accountConnectKey=abc123&supportsCredentialVariants=1');
    });
});

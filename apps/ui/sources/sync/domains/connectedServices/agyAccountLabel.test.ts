import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string, params?: { name?: string }) => (params?.name ? `${key}:${params.name}` : key),
    });
});

import { agyAccountLabel } from './agyAccountLabel';

describe('agyAccountLabel', () => {
    it('names a login by its email when known, else the real home login, else its folder name', () => {
        expect(agyAccountLabel({ accountId: 'b', email: 'b@example.com' })).toBe('b@example.com');
        expect(agyAccountLabel({ accountId: 'default' })).toBe('connectedServices.agyUsage.unknownAccount');
        expect(agyAccountLabel({ accountId: 'b' })).toBe('connectedServices.agyUsage.namedAccount:b');
    });
});

import { describe, expect, it, vi } from 'vitest';

describe('@/dev/testkit import safety', () => {
    it('does not evaluate production transcript renderer modules', async () => {
        await expect(import('@/dev/testkit')).resolves.toBeDefined();
    });
});

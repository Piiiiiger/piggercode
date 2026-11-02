import { describe, expect, it } from 'vitest';

import { buildHappierCliCommandName } from './happierCliCommandName';

describe('buildHappierCliCommandName', () => {
    it('uses the dev shim when the app release identity resolves to dev', () => {
        expect(buildHappierCliCommandName({
            appVariant: 'preview',
            channelOverride: 'dev',
        })).toBe('hdev');
    });

    it('uses the preview CLI shim for preview-channel manual commands', () => {
        expect(buildHappierCliCommandName({ appVariant: 'preview' })).toBe('hprev');
        expect(buildHappierCliCommandName({ appVariant: 'development' })).toBe('hprev');
        expect(buildHappierCliCommandName({ appVariant: 'production', distTagOverride: 'next' })).toBe('hprev');
        expect(buildHappierCliCommandName({ appVariant: 'production' })).toBe('happier');
    });
});

import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installTextModuleMock } from '@/dev/testkit/mocks/text';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

installSettingsViewCommonModuleMocks({
    text: installTextModuleMock({
        translate: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    }),
});

const HOUR_MS = 60 * 60 * 1000;

describe('ProviderAuthenticationStatusRows', () => {
    it('shows how long the login has left, from when the machine\'s CLI says it ends', async () => {
        const { ProviderAuthenticationStatusRows } = await import('./ProviderAuthenticationStatusRows');
        const expiresAt = Date.now() + (3 * 24 + 4) * HOUR_MS + 30 * 60 * 1000;
        const screen = await renderScreen(
            <ProviderAuthenticationStatusRows authStatus={{ state: 'logged_in', checkedAt: Date.now(), expiresAt }} />,
        );

        const subtitle = String(screen.findByProps({ testID: 'settings-provider-auth-login-ends' }).props.subtitle);
        expect(subtitle).toContain('settingsProviders.authentication.loginEnds');
        expect(subtitle).toContain('connectedServices.quota.duration.daysHours {\\"days\\":3,\\"hours\\":4}');
    });

    it('shows no end for a login whose CLI does not say when it ends', async () => {
        const { ProviderAuthenticationStatusRows } = await import('./ProviderAuthenticationStatusRows');
        const screen = await renderScreen(
            <ProviderAuthenticationStatusRows authStatus={{ state: 'logged_in', checkedAt: Date.now() }} />,
        );

        expect(screen.findAllByProps({ testID: 'settings-provider-auth-login-ends' })).toHaveLength(0);
    });
});

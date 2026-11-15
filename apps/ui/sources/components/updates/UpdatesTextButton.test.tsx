import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { UpdatesTextButton } from './UpdatesTextButton';

describe('UpdatesTextButton', () => {
    it('spins before its label and waits while what it started still runs', async () => {
        const onPress = vi.fn();
        const busy = await renderScreen(<UpdatesTextButton label="Check for updates" onPress={onPress} busy testID="check" />);
        expect(busy.findByTestId('check:busy')).not.toBeNull();
        expect(busy.findByTestId('check')?.props).toMatchObject({ disabled: true, accessibilityState: { busy: true } });

        const idle = await renderScreen(<UpdatesTextButton label="Check for updates" onPress={onPress} testID="check" />);
        expect(idle.findByTestId('check:busy')).toBeNull();
        expect(idle.findByTestId('check')?.props.disabled).toBe(false);
    });
});

import { describe, expect, it } from 'vitest';

import type { Metadata } from '../state/storageTypes';
import {
    computeSessionConfigOptionControls,
    computeSessionConfigOptionControlsForProvider,
} from './configOptionsControl';

function createMetadata(overrides: Partial<Metadata> = {}): Metadata {
    return {
        path: '/tmp',
        host: 'h',
        ...overrides,
    } as Metadata;
}

describe('computeSessionConfigOptionControls', () => {
    it('hides model config options from override controls when model options own them', () => {
        const res = computeSessionConfigOptionControlsForProvider({
            providerId: 'codex',
            hideModeOption: true,
            hideModelOption: true,
            configOptions: [
                {
                    id: 'mode',
                    name: 'Mode',
                    type: 'select',
                    currentValue: 'agent',
                    options: [{ value: 'agent', name: 'Agent' }],
                },
                {
                    id: 'model',
                    name: 'Model',
                    type: 'select',
                    currentValue: 'composer-2.5',
                    options: [{ value: 'composer-2.5', name: 'Composer 2.5' }],
                },
                {
                    id: 'fast',
                    name: 'Fast',
                    description: 'Faster speeds.',
                    category: 'model_config',
                    type: 'select',
                    currentValue: 'true',
                    options: [
                        { value: 'false', name: 'Off' },
                        { value: 'true', name: 'Fast' },
                    ],
                },
                {
                    id: 'telemetry',
                    name: 'Telemetry',
                    type: 'boolean',
                    currentValue: 'false',
                },
            ],
        });

        expect(res?.map((control) => control.option.id)).toEqual(['telemetry']);
    });

});

describe('ultracode override of the reasoning effort control', () => {
    const configOptions = [
        {
            id: 'reasoning_effort',
            name: 'Thinking',
            type: 'select',
            currentValue: 'high',
            options: [
                { value: 'high', name: 'High' },
                { value: 'xhigh', name: 'XHigh' },
            ],
        },
        { id: 'ultracode', name: 'Ultracode', type: 'boolean', currentValue: 'false' },
    ];

    it('marks the reasoning effort control disabled while ultracode is effectively on', () => {
        const controls = computeSessionConfigOptionControlsForProvider({
            providerId: 'claude',
            configOptions,
            overrides: { ultracode: { value: 'true' } },
        });
        const effort = controls?.find((control) => control.option.id === 'reasoning_effort');
        expect(effort?.disabled).toBe(true);
        expect(effort?.disabledByOptionName).toBe('Ultracode');
        const ultracode = controls?.find((control) => control.option.id === 'ultracode');
        expect(ultracode?.disabled).not.toBe(true);
    });

    it('keeps the reasoning effort control enabled while ultracode is off', () => {
        const controls = computeSessionConfigOptionControlsForProvider({
            providerId: 'claude',
            configOptions,
        });
        const effort = controls?.find((control) => control.option.id === 'reasoning_effort');
        expect(effort?.disabled).not.toBe(true);
        expect(effort?.disabledByOptionName).toBeUndefined();
    });
});

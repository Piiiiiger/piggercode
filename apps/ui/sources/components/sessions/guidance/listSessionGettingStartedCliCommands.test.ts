import Constants from 'expo-constants';
import { afterEach, describe, expect, it } from 'vitest';

import { listSessionGettingStartedCliCommands } from './listSessionGettingStartedCliCommands';

describe('listSessionGettingStartedCliCommands', () => {
    afterEach(() => {
        delete (Constants.expoConfig!.extra as Record<string, unknown>).app;
    });

    it('names a command per example agent', () => {
        expect(listSessionGettingStartedCliCommands('piggercode')).toEqual(['piggercode', 'piggercode codex', 'piggercode opencode']);
    });

    it('leaves out the agents the build does not offer', () => {
        (Constants.expoConfig!.extra as Record<string, unknown>).app = { agentIds: ['claude', 'codex'] };

        expect(listSessionGettingStartedCliCommands('piggercode')).toEqual(['piggercode', 'piggercode codex']);
    });
});

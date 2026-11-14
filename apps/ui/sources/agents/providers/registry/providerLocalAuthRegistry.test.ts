import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from '@/agents/catalog/catalog';
import { getProviderCliInstallGuideUrl } from '@piggercode/agents';

import { getProviderLocalAuthPlugin } from './providerLocalAuthRegistry';

describe('provider local auth registry', () => {
    it('covers every agent id with an explicit local auth plugin', () => {
        expect(new Set(AGENT_IDS.map((agentId) => getProviderLocalAuthPlugin(agentId)?.providerId ?? null))).toEqual(new Set(AGENT_IDS));
    });

    it('signs in to Claude with `claude auth login`, which prints a link and then asks for the code', () => {
        const plugin = getProviderLocalAuthPlugin('claude');
        const launches = plugin?.buildAuthLaunches?.({ resolvedPath: '/usr/local/bin/claude' }) ?? [];

        expect(launches).toEqual([{
            kind: 'primary',
            initialCommand: '/usr/local/bin/claude auth login',
            signIn: 'link_then_code',
        }]);
    });

    it('returns a Codex launch strategy that runs the direct login command', () => {
        const plugin = getProviderLocalAuthPlugin('codex');
        const launches = plugin?.buildAuthLaunches?.({ resolvedPath: '/usr/local/bin/codex' }) ?? [];

        expect(launches).toEqual([{
            kind: 'primary',
            initialCommand: '/usr/local/bin/codex login',
        }]);
    });

    it('uses centralized provider setup guide URLs for local auth plugins', () => {
        for (const providerId of ['claude', 'codex'] as const) {
            expect(getProviderLocalAuthPlugin(providerId)?.docsUrl ?? null).toBe(getProviderCliInstallGuideUrl(providerId));
        }
    });

    it('prefers a resolved shell command when the CLI requires a runtime wrapper', () => {
        const plugin = getProviderLocalAuthPlugin('codex');
        const launches = plugin?.buildAuthLaunches?.({
            resolvedPath: '/opt/tools/fake-codex.js',
            resolvedCommand: `'bun' '/opt/tools/fake-codex.js'`,
            platform: 'darwin',
        }) ?? null;

        expect(launches).toEqual([{
            kind: 'primary',
            initialCommand: `'bun' '/opt/tools/fake-codex.js' login`,
        }]);
    });

    it('quotes a fallback resolvedPath when the CLI path contains spaces', () => {
        const plugin = getProviderLocalAuthPlugin('codex');
        const launches = plugin?.buildAuthLaunches?.({
            resolvedPath: '/Applications/Codex App/bin/codex',
            resolvedCommand: null,
            platform: 'darwin',
        }) ?? null;

        expect(launches).toEqual([{
            kind: 'primary',
            initialCommand: `'/Applications/Codex App/bin/codex' login`,
        }]);
    });
});

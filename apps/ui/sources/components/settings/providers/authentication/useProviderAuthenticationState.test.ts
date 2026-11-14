import { describe, expect, it } from 'vitest';
import { renderHook } from '@/dev/testkit';
import { useProviderAuthenticationState } from './useProviderAuthenticationState';
import type { CLIAvailability } from '@/hooks/auth/useCLIDetection';
import type { ProviderLocalAuthPlugin } from '@/agents/providers/shared/providerLocalAuthPlugin';

describe('useProviderAuthenticationState', () => {
    it('passes resolvedCommand to buildAuthLaunches when available', async () => {
        const buildAuthLaunchesMock = ({ resolvedPath, resolvedCommand }: { resolvedPath?: string | null; resolvedCommand?: string | null }) => [{
            kind: 'primary' as const,
            initialCommand: resolvedCommand ?? (resolvedPath ? `${resolvedPath} login` : 'codex login'),
        }];

        const authPlugin: ProviderLocalAuthPlugin = {
            providerId: 'codex',
            support: 'login_terminal',
            buildAuthLaunches: buildAuthLaunchesMock,
            docsUrl: undefined,
            statusHelpText: undefined,
        };

        const cliAvailability: CLIAvailability = {
            available: { codex: true } as any,
            login: { codex: null } as any,
            authStatus: { codex: null } as any,
            resolvedPath: { codex: '/opt/codex/bin/codex' } as any,
            resolvedCommand: { codex: `'/opt/codex/bin/codex'` } as any,
            resolutionSource: { codex: 'system' } as any,
            tmux: null,
            isDetecting: false,
            timestamp: 123,
            refresh: () => {},
        };

        const primaryMachine = {
            id: 'm1',
            metadata: { homeDir: '/home/user' },
        };

        const hook = await renderHook(() =>
            useProviderAuthenticationState({
                providerId: 'codex' as any,
                cliAvailability,
                authPlugin,
                desktopControls: true,
                primaryMachine,
            })
        );

        expect(hook.getCurrent().authLaunches[0]?.initialCommand).toBe(`'/opt/codex/bin/codex'`);
    });

    it('passes null resolvedPath when CLI is not available', async () => {
        const buildAuthLaunchesMock = ({ resolvedPath }: { resolvedPath?: string | null }) => [{
            kind: 'primary' as const,
            initialCommand: resolvedPath ? `${resolvedPath} login` : 'codex login',
        }];

        const authPlugin: ProviderLocalAuthPlugin = {
            providerId: 'codex',
            support: 'login_terminal',
            buildAuthLaunches: buildAuthLaunchesMock,
            docsUrl: undefined,
            statusHelpText: undefined,
        };

        const cliAvailability: CLIAvailability = {
            available: { codex: false } as any,
            login: { codex: null } as any,
            authStatus: { codex: null } as any,
            resolvedPath: { codex: null } as any,
            resolvedCommand: { codex: null } as any,
            resolutionSource: { codex: null } as any,
            tmux: null,
            isDetecting: false,
            timestamp: 123,
            refresh: () => {},
        };

        const primaryMachine = {
            id: 'm1',
            metadata: { homeDir: '/home/user' },
        };

        const hook = await renderHook(() =>
            useProviderAuthenticationState({
                providerId: 'codex' as any,
                cliAvailability,
                authPlugin,
                desktopControls: true,
                primaryMachine,
            })
        );

        expect(hook.getCurrent().authLaunches[0]?.initialCommand).toBe('codex login');
    });

    it('allows launching the login terminal when the machine home directory is unavailable', async () => {
        const authPlugin: ProviderLocalAuthPlugin = {
            providerId: 'codex',
            support: 'login_terminal',
            buildAuthLaunches: () => [{ kind: 'primary', initialCommand: 'codex login' }],
            docsUrl: undefined,
            statusHelpText: undefined,
        };

        const cliAvailability: CLIAvailability = {
            available: { codex: true } as any,
            login: { codex: null } as any,
            authStatus: { codex: null } as any,
            resolvedPath: { codex: '/opt/codex/bin/codex' } as any,
            resolvedCommand: { codex: `'/opt/codex/bin/codex'` } as any,
            resolutionSource: { codex: 'system' } as any,
            tmux: null,
            isDetecting: false,
            timestamp: 123,
            refresh: () => {},
        };

        const primaryMachine = {
            id: 'm1',
            metadata: {},
        };

        const hook = await renderHook(() =>
            useProviderAuthenticationState({
                providerId: 'codex' as any,
                cliAvailability,
                authPlugin,
                desktopControls: true,
                primaryMachine,
            })
        );

        expect(hook.getCurrent().canLaunchAuth).toBe(true);
        expect(hook.getCurrent().machineHomeDir).toBe(null);
    });

    it('offers a link-then-code login wherever the app runs, and a terminal login only in the desktop app', async () => {
        const plugins: Record<'claude' | 'codex', ProviderLocalAuthPlugin> = {
            claude: {
                providerId: 'claude',
                support: 'login_terminal',
                buildAuthLaunches: () => [{ kind: 'primary', initialCommand: 'claude auth login', signIn: 'link_then_code' }],
            },
            codex: {
                providerId: 'codex',
                support: 'login_terminal',
                buildAuthLaunches: () => [{ kind: 'primary', initialCommand: 'codex login' }],
            },
        };
        const cliAvailability: CLIAvailability = {
            available: { claude: true, codex: true } as any,
            login: { claude: null, codex: null } as any,
            authStatus: { claude: null, codex: null } as any,
            resolvedPath: { claude: '/usr/bin/claude', codex: '/usr/bin/codex' } as any,
            resolvedCommand: {} as any,
            resolutionSource: { claude: 'system', codex: 'system' } as any,
            tmux: null,
            isDetecting: false,
            timestamp: 123,
            refresh: () => {},
        };
        const surface = async (providerId: 'claude' | 'codex', desktopControls: boolean) => {
            const hook = await renderHook(() =>
                useProviderAuthenticationState({
                    providerId,
                    cliAvailability,
                    authPlugin: plugins[providerId],
                    desktopControls,
                    primaryMachine: { id: 'm1', metadata: {} },
                })
            );
            const state = hook.getCurrent();
            return { surface: state.primaryLaunchSurface, showActions: state.showActions };
        };

        await expect(surface('claude', false)).resolves.toEqual({ surface: 'link', showActions: true });
        await expect(surface('claude', true)).resolves.toEqual({ surface: 'link', showActions: true });
        await expect(surface('codex', false)).resolves.toEqual({ surface: null, showActions: false });
        await expect(surface('codex', true)).resolves.toEqual({ surface: 'terminal', showActions: true });
    });
});

import * as React from 'react';

import type { AgentId } from '@/agents/catalog/catalog';
import type { ProviderLocalAuthPlugin } from '@/agents/providers/shared/providerLocalAuthPlugin';
import type { CLIAvailability } from '@/hooks/auth/useCLIDetection';
import { resolveProviderAuthLaunchSurface } from './providerAuthLaunchSurface';

export type ProviderAuthenticationState = Readonly<ReturnType<typeof useProviderAuthenticationState>>;

export function useProviderAuthenticationState(params: Readonly<{
    providerId: AgentId;
    cliAvailability: CLIAvailability;
    authPlugin: ProviderLocalAuthPlugin | null;
    /** Whether this app shows terminals for logins (the desktop app). */
    desktopControls: boolean;
    primaryMachine: Readonly<{
        id: string;
        metadata?: {
            homeDir?: string | null;
            platform?: string | null;
        } | null;
    }> | null;
}>) {
    return React.useMemo(() => {
        const authStatus = params.cliAvailability.authStatus[params.providerId] ?? null;
        const cliAvailable = params.cliAvailability.available[params.providerId] ?? null;
        const resolvedPath = params.cliAvailability.resolvedPath[params.providerId] ?? null;
        const resolvedCommand = params.cliAvailability.resolvedCommand?.[params.providerId] ?? null;
        const machineMetadata = params.primaryMachine?.metadata as {
            homeDir?: string | null;
            platform?: string | null;
        } | null | undefined;
        const machineId = params.primaryMachine?.id ?? null;
        const machineHomeDir = machineMetadata?.homeDir ?? null;
        const machinePlatform = machineMetadata?.platform ?? null;
        const canCheckNow = Boolean(machineId);
        const supportsLoginTerminal = params.authPlugin?.support === 'login_terminal';
        const authLaunches = supportsLoginTerminal
            ? (params.authPlugin?.buildAuthLaunches?.({ resolvedPath, resolvedCommand, platform: machinePlatform }) ?? [])
            : [];
        const canLaunchAuth = cliAvailable === true && Boolean(machineId) && authLaunches.some((launch) => Boolean(launch.initialCommand));
        const loginActionKind = authStatus?.state === 'logged_in' ? 'reauthenticate' : 'login';
        const primaryLaunchSurface = resolveProviderAuthLaunchSurface(
            authLaunches.find((launch) => launch.kind === 'primary'),
            params.desktopControls,
        );
        const deviceCodeLaunchSurface = resolveProviderAuthLaunchSurface(
            authLaunches.find((launch) => launch.kind === 'device_code'),
            params.desktopControls,
        );
        const showActions = params.desktopControls || primaryLaunchSurface !== null || deviceCodeLaunchSurface !== null;

        return {
            authStatus,
            cliAvailable,
            machineId,
            machineHomeDir,
            canCheckNow,
            supportsLoginTerminal,
            canLaunchAuth,
            authLaunches,
            primaryLaunchSurface,
            deviceCodeLaunchSurface,
            showActions,
            loginActionKind,
            docsUrl: params.authPlugin?.docsUrl ?? null,
            support: params.authPlugin?.support ?? 'unsupported',
            statusHelpText: params.authPlugin?.statusHelpText ?? null,
        } as const;
    }, [params.authPlugin, params.cliAvailability, params.desktopControls, params.primaryMachine, params.providerId]);
}

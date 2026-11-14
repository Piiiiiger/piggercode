import type { ProviderLocalAuthLaunch } from '@/agents/providers/shared/providerLocalAuthPlugin';

/**
 * Where a provider login runs. One that prints a sign-in link and then asks for the code shows as that link and a box
 * for the code (`ProviderAuthenticationLinkLogin`), wherever the app runs; any other needs a terminal, which only the
 * desktop app shows (its bottom pane).
 */
export type ProviderAuthLaunchSurface = 'link' | 'terminal';

export function resolveProviderAuthLaunchSurface(
    launch: ProviderLocalAuthLaunch | null | undefined,
    desktopControls: boolean,
): ProviderAuthLaunchSurface | null {
    if (!launch) return null;
    if (launch.signIn === 'link_then_code' && launch.initialCommand) return 'link';
    return desktopControls ? 'terminal' : null;
}

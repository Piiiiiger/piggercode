import type { DirectSessionsProviderId } from '@piggercode/protocol';

export function getPreferredDirectBrowseProviderId(
    providerIds: readonly DirectSessionsProviderId[],
    selectedProviderId: DirectSessionsProviderId | null,
): DirectSessionsProviderId | null {
    if (selectedProviderId && providerIds.includes(selectedProviderId)) return selectedProviderId;
    return providerIds[0] ?? null;
}

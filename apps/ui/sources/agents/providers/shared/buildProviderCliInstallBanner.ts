import type { AgentId } from '@piggercode/agents';
import { getProviderCliInstallGuideUrl, getProviderCliRuntimeSpec } from '@piggercode/agents';

export function buildProviderCliInstallBanner(
    providerId: AgentId,
    options: Readonly<{ guideUrl?: string | null }> = {},
) {
    const runtimeSpec = getProviderCliRuntimeSpec(providerId);
    return {
        installKind: 'ifAvailable' as const,
        guideUrl: options.guideUrl ?? getProviderCliInstallGuideUrl(providerId) ?? runtimeSpec.docsUrl ?? undefined,
    };
}

import type { AppVariant } from '@/sync/runtime/appVariant';

type HappierCliInstallChannel = 'stable' | 'preview' | 'dev';

function toOptionalNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
}

function resolveInstallChannel(input: Readonly<{
    appVariant: AppVariant;
    distTagOverride?: unknown;
    channelOverride?: HappierCliInstallChannel;
}>): HappierCliInstallChannel {
    if (input.channelOverride) return input.channelOverride;
    const override = input.distTagOverride === undefined ? undefined : toOptionalNonEmptyString(input.distTagOverride);
    if (override === 'next' || override === 'preview') return 'preview';
    if (input.appVariant === 'production') return 'stable';
    return 'preview';
}

export function buildHappierCliCommandName(input: Readonly<{
    appVariant: AppVariant;
    distTagOverride?: unknown;
    channelOverride?: HappierCliInstallChannel;
}>): 'piggercode' | 'hprev' | 'hdev' {
    const channel = resolveInstallChannel(input);
    if (channel === 'dev') return 'hdev';
    return channel === 'preview' ? 'hprev' : 'piggercode';
}

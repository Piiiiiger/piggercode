import type { Settings } from '@/sync/domains/settings/settings';

/**
 * Account settings that are never queued: a queued value could be written long after it was decided (a
 * client that went offline), over a newer one. They change only through the settings engine's
 * `exclusiveUpdate` (one read, one compare-and-set write); a queued value is never written or shown.
 */
export const ONE_SHOT_ACCOUNT_SETTING_KEYS = ['connectedServicesManagementV1'] as const satisfies ReadonlyArray<keyof Settings>;

export type OneShotAccountSettingKey = (typeof ONE_SHOT_ACCOUNT_SETTING_KEYS)[number];

export function withoutOneShotAccountSettings(pendingSettings: Partial<Settings>): Partial<Settings> {
    const next: Record<string, unknown> = { ...pendingSettings };
    for (const key of ONE_SHOT_ACCOUNT_SETTING_KEYS) delete next[key];
    return next as Partial<Settings>;
}

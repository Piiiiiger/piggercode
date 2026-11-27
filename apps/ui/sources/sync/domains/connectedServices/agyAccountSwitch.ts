import {
    AGY_ACCOUNT_SWITCH_CONFIRM_RPC_METHOD,
    AgyAccountSwitchStateV1Schema,
    type AgyAccountSwitchStateV1,
} from '@piggercode/protocol';

/**
 * What the agy runner writes into session metadata about the login it runs on (UA2/UA3). The protocol schema is
 * the only parser; anything malformed reads as absent: an old CLI writes nothing and a newer one may add fields,
 * neither may break the session view.
 */
export type { AgyAccountSwitchStateV1 };

export const AGY_ACCOUNT_SWITCH_CONFIRM_METHOD = AGY_ACCOUNT_SWITCH_CONFIRM_RPC_METHOD;

/** The `switched` banner is transient: it hides this long after the CLI wrote it. */
export const AGY_SWITCHED_BANNER_VISIBLE_MS = 60_000;

function nonEmptyString(raw: unknown): string | undefined {
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function parseAgyAccountSwitchV1(raw: unknown): AgyAccountSwitchStateV1 | null {
    const parsed = AgyAccountSwitchStateV1Schema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/** The login this session's agy runs on; absent (old CLI, not started yet) reads as `null`. */
export function readAgyAccountId(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    return nonEmptyString((metadata as Record<string, unknown>).agyAccountId) ?? null;
}

export function readAgyAccountSwitch(metadata: unknown): AgyAccountSwitchStateV1 | null {
    if (!metadata || typeof metadata !== 'object') return null;
    return parseAgyAccountSwitchV1((metadata as Record<string, unknown>).agyAccountSwitchV1);
}

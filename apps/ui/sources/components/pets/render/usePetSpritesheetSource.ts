import * as React from 'react';
import type { ImageProps } from 'expo-image';
import {
    DaemonPetReadPreviewAssetResponseV1Schema,
    PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1,
    PET_DAEMON_RPC_METHODS,
    type DaemonPetReadPreviewAssetRequestV1,
    type PetAssetMediaTypeV1,
} from '@piggercode/protocol';

import type { SelectedPetPackageSource } from '@/components/pets/source/resolveSelectedPetPackage';
import { encodeBase64 } from '@/encryption/base64';
import { serverFetch } from '@/sync/http/client';
import { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedContext';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';

/** Spritesheets this window has loaded, by `readPetSpritesheetKey` (pet and content digest). */
const spritesheetCache = new Map<string, NonNullable<ImageProps['source']>>();

type PetSpritesheetSourceStatus = 'loading' | 'ready' | 'error';

export type PetSpritesheetSourceResult = Readonly<{
    /** The spritesheet once it has loaded; null while it loads and when it cannot be loaded. */
    source: ImageProps['source'] | null;
    status: PetSpritesheetSourceStatus;
}>;

/** Names one pet's spritesheet content; every window computes the same key for the same selected pet. */
export function readPetSpritesheetKey(source: SelectedPetPackageSource): string {
    const id = source.kind === 'accountPet' ? source.accountPetId : source.sourceKey;
    return `${source.kind}:${id}:${source.digest ?? ''}`;
}

function readCachedSpritesheet(source: SelectedPetPackageSource | null): ImageProps['source'] | null {
    if (!source?.digest) return null;
    return spritesheetCache.get(readPetSpritesheetKey(source)) ?? null;
}

function isAllowedPetAssetMediaType(value: string | null | undefined): value is PetAssetMediaTypeV1 {
    const mediaType = String(value ?? '').split(';')[0]?.trim().toLowerCase();
    return mediaType === 'image/png' || mediaType === 'image/webp';
}

function toDataUri(mediaType: PetAssetMediaTypeV1, dataBase64: string): string {
    return `data:${mediaType};base64,${dataBase64}`;
}

function readContentType(headers: Headers): PetAssetMediaTypeV1 | null {
    const mediaType = String(headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
    return isAllowedPetAssetMediaType(mediaType) ? mediaType : null;
}

async function readAccountPetSpritesheetSource(
    source: Extract<SelectedPetPackageSource, { kind: 'accountPet' }>,
): Promise<ImageProps['source'] | null> {
    const response = await serverFetch(
        `/v1/account/pets/${source.accountPetId}/spritesheet`,
        undefined,
        { retry: 'none' },
    );
    if (!response.ok) return null;

    const mediaType = readContentType(response.headers);
    if (!mediaType) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    const result = toDataUri(mediaType, encodeBase64(bytes, 'base64'));
    if (source.digest) spritesheetCache.set(readPetSpritesheetKey(source), result);
    return result;
}

/** What a preview read's budget timer resolves to; nothing the daemon answers can equal it. */
const BUDGET_SPENT: unique symbol = Symbol('budgetSpent');

async function readDaemonPetPreviewSource(
    source: Extract<SelectedPetPackageSource, { kind: 'detectedCodexHome' | 'happierManagedLocal' }>,
    isCancelled: () => boolean,
): Promise<ImageProps['source'] | null> {
    const target = source.daemonTarget;
    if (!target?.machineId || !target.serverId) return null;

    const payload: DaemonPetReadPreviewAssetRequestV1 = { sourceKey: source.sourceKey };
    // The daemon takes one preview read per `readPreviewAssetMinIntervalMs`, for all pets together, and refuses the
    // rest with `rate_limited`: reads made together (the overlay and Settings' pet tiles, several tiles) collide. Ask
    // again after that interval. The whole read, every attempt included, gets one machine RPC's budget: each attempt
    // is given what is left, and the read also ends at the deadline itself, because the transport can outlast a
    // timeout (an active-socket attempt, then a scoped fallback with the same timeout). A read still waiting then has
    // failed, so a surface stops waiting for it (the desktop overlay's window is hidden).
    const deadline = Date.now() + DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS;
    let stopBudgetTimer: () => void = () => undefined;
    const budgetSpent = new Promise<typeof BUDGET_SPENT>((resolve) => {
        const timer = setTimeout(() => resolve(BUDGET_SPENT), DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS);
        stopBudgetTimer = () => clearTimeout(timer);
    });
    try {
        for (;;) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0 || isCancelled()) return null;
            const raw = await Promise.race([
                machineRpcWithServerScope<unknown, DaemonPetReadPreviewAssetRequestV1>({
                    machineId: target.machineId,
                    serverId: target.serverId,
                    method: PET_DAEMON_RPC_METHODS.READ_PREVIEW_ASSET,
                    payload,
                    timeoutMs: remainingMs,
                }),
                budgetSpent,
            ]);
            if (raw === BUDGET_SPENT) return null;
            const parsed = DaemonPetReadPreviewAssetResponseV1Schema.parse(raw);
            if (!('ok' in parsed)) {
                if (!isAllowedPetAssetMediaType(parsed.mediaType)) return null;
                const result = toDataUri(parsed.mediaType, parsed.dataBase64);
                spritesheetCache.set(readPetSpritesheetKey({ ...source, digest: parsed.digest }), result);
                return result;
            }
            if (parsed.errorCode !== 'rate_limited') return null;
            const waited = await Promise.race([
                new Promise<void>((resolve) => {
                    setTimeout(resolve, PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1.readPreviewAssetMinIntervalMs);
                }),
                budgetSpent,
            ]);
            if (waited === BUDGET_SPENT) return null;
        }
    } finally {
        stopBudgetTimer();
    }
}

function readInitialResult(source: SelectedPetPackageSource | null): PetSpritesheetSourceResult {
    const cached = readCachedSpritesheet(source);
    if (cached) return { source: cached, status: 'ready' };
    return { source: null, status: source ? 'loading' : 'ready' };
}

/**
 * Loads the selected pet's spritesheet. `source` is null while it loads and when it cannot be loaded (`status` says
 * which). There is no stand-in pet (PiggerCode ships no built-in pets), so surfaces show the pet, its press target and
 * its tray only once `source` is set: an invisible pet must not take presses. A spritesheet this window already loaded
 * is ready at once, also when the selection's source object is rebuilt with the same content.
 */
export function usePetSpritesheetSourceResult(source: SelectedPetPackageSource | null): PetSpritesheetSourceResult {
    const [result, setResult] = React.useState<PetSpritesheetSourceResult>(() => readInitialResult(source));

    React.useEffect(() => {
        let cancelled = false;
        const initial = readInitialResult(source);
        setResult((current) => (current.source === initial.source && current.status === initial.status ? current : initial));
        if (!source || initial.status === 'ready') return undefined;

        const apply = async () => {
            try {
                const loaded = source.kind === 'accountPet'
                    ? await readAccountPetSpritesheetSource(source)
                    : await readDaemonPetPreviewSource(source, () => cancelled);
                if (!cancelled) setResult({ source: loaded, status: loaded ? 'ready' : 'error' });
            } catch {
                if (!cancelled) setResult({ source: null, status: 'error' });
            }
        };

        void apply();
        return () => {
            cancelled = true;
        };
    }, [source]);

    return result;
}

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
import { delay, linearBackoffDelay } from '@/utils/timing/time';

/** Spritesheets this window has loaded, by `readPetSpritesheetKey` (pet and content digest). */
const spritesheetCache = new Map<string, NonNullable<ImageProps['source']>>();

// A read that got no answer is asked again, spaced out: one answer can be a couple of MB, on a link that has just
// failed, and the pet is decoration. The wait ramps from the minimum to the maximum over the ramp's failures.
const NO_ANSWER_RETRY_MIN_DELAY_MS = 5_000;
const NO_ANSWER_RETRY_MAX_DELAY_MS = 120_000;
const NO_ANSWER_RETRY_RAMP_FAILURES = 8;

type PetSpritesheetSourceStatus = 'loading' | 'ready' | 'error';

export type PetSpritesheetSourceResult = Readonly<{
    /** The spritesheet once it has loaded; null while it loads and when it cannot be loaded. */
    source: ImageProps['source'] | null;
    status: PetSpritesheetSourceStatus;
}>;

const FAILED_RESULT: PetSpritesheetSourceResult = { source: null, status: 'error' };

/** Names one pet's spritesheet content; every window computes the same key for the same selected pet. */
export function readPetSpritesheetKey(source: SelectedPetPackageSource): string {
    const id = source.kind === 'accountPet' ? source.accountPetId : source.sourceKey;
    return `${source.kind}:${id}:${source.digest ?? ''}`;
}

/** One load: the content, and for a daemon pet the machine serving it. The selection rebuilds its source objects. */
function readPetSpritesheetLoadKey(source: SelectedPetPackageSource): string {
    const target = source.kind === 'accountPet' ? undefined : source.daemonTarget;
    return `${readPetSpritesheetKey(source)}@${target?.serverId ?? ''}/${target?.machineId ?? ''}`;
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

/** Resolves to the spritesheet, or null when the answer is that it cannot be shown. Rejects when no answer came. */
async function readAccountPetSpritesheetSource(
    source: Extract<SelectedPetPackageSource, { kind: 'accountPet' }>,
): Promise<ImageProps['source'] | null> {
    const response = await serverFetch(
        `/v1/account/pets/${source.accountPetId}/spritesheet`,
        undefined,
        { retry: 'none' },
    );
    if (response.status >= 500) throw new Error(`Pet spritesheet read failed with ${response.status}`);
    if (!response.ok) return null;

    const mediaType = readContentType(response.headers);
    if (!mediaType) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    const result = toDataUri(mediaType, encodeBase64(bytes, 'base64'));
    if (source.digest) spritesheetCache.set(readPetSpritesheetKey(source), result);
    return result;
}

/** Resolves to the spritesheet, or null when the daemon answers that it cannot be shown. Rejects when no answer came. */
async function readDaemonPetPreviewSource(
    source: Extract<SelectedPetPackageSource, { kind: 'detectedCodexHome' | 'happierManagedLocal' }>,
    isCancelled: () => boolean,
): Promise<ImageProps['source'] | null> {
    const target = source.daemonTarget;
    if (!target?.machineId || !target.serverId) return null;

    const payload: DaemonPetReadPreviewAssetRequestV1 = { sourceKey: source.sourceKey };
    // The daemon takes one preview read per `readPreviewAssetMinIntervalMs`, for all pets together, and refuses the
    // rest with `rate_limited`: reads made together (the overlay and Settings' pet tiles, several tiles) collide. Ask
    // again after that interval, every attempt within one machine RPC's budget. Each attempt waits for the transport
    // to settle (every step of it is bounded), so a surface never has two reads of its pet in flight.
    const deadline = Date.now() + DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS;
    for (;;) {
        if (isCancelled()) return null;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('Pet preview read was refused for its whole budget');
        const raw = await machineRpcWithServerScope<unknown, DaemonPetReadPreviewAssetRequestV1>({
            machineId: target.machineId,
            serverId: target.serverId,
            method: PET_DAEMON_RPC_METHODS.READ_PREVIEW_ASSET,
            payload,
            timeoutMs: remainingMs,
        });
        const parsed = DaemonPetReadPreviewAssetResponseV1Schema.safeParse(raw);
        if (!parsed.success) return null;
        const answer = parsed.data;
        if (!('ok' in answer)) {
            if (!isAllowedPetAssetMediaType(answer.mediaType)) return null;
            const result = toDataUri(answer.mediaType, answer.dataBase64);
            spritesheetCache.set(readPetSpritesheetKey({ ...source, digest: answer.digest }), result);
            return result;
        }
        if (answer.errorCode !== 'rate_limited') return null;
        await delay(PET_DAEMON_RPC_DEBOUNCE_LIMITS_V1.readPreviewAssetMinIntervalMs);
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
 * is ready at once, also when the selection's source object is rebuilt with the same content. A read that got no answer
 * (the daemon's connection dropped, a timeout) is asked again until it loads; the daemon's answer that it cannot serve
 * this pet is final.
 */
export function usePetSpritesheetSourceResult(source: SelectedPetPackageSource | null): PetSpritesheetSourceResult {
    const [result, setResult] = React.useState<PetSpritesheetSourceResult>(() => readInitialResult(source));
    const loadKey = source ? readPetSpritesheetLoadKey(source) : null;

    // Keyed on the load, not the object: a rebuilt selection must not restart a read or its retry spacing.
    React.useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const initial = readInitialResult(source);
        setResult((current) => (current.source === initial.source && current.status === initial.status ? current : initial));
        if (!source || initial.status === 'ready') return undefined;

        const load = async (failures: number) => {
            try {
                const loaded = source.kind === 'accountPet'
                    ? await readAccountPetSpritesheetSource(source)
                    : await readDaemonPetPreviewSource(source, () => cancelled);
                if (!cancelled) setResult(loaded ? { source: loaded, status: 'ready' } : FAILED_RESULT);
            } catch {
                if (cancelled) return;
                setResult(FAILED_RESULT);
                const nextFailures = failures + 1;
                retryTimer = setTimeout(() => void load(nextFailures), linearBackoffDelay(
                    nextFailures,
                    NO_ANSWER_RETRY_MIN_DELAY_MS,
                    NO_ANSWER_RETRY_MAX_DELAY_MS,
                    NO_ANSWER_RETRY_RAMP_FAILURES,
                ));
            }
        };

        void load(0);
        return () => {
            cancelled = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
        };
    }, [loadKey]);

    return result;
}

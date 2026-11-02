import type { DirectTranscriptRawMessageV1 } from '@piggercode/protocol';

import { normalizeRawMessage, type NormalizedMessage } from '@/sync/typesRaw';

export function normalizeDirectTranscriptMessages(items: ReadonlyArray<DirectTranscriptRawMessageV1>): NormalizedMessage[] {
    const out: NormalizedMessage[] = [];
    for (const item of items) {
        const normalized = normalizeRawMessage(
            item.id,
            typeof item.localId === 'string' ? item.localId : null,
            item.createdAtMs,
            item.raw,
            { messageRole: item.messageRole ?? undefined },
        );
        if (normalized) out.push(normalized);
    }
    return out;
}

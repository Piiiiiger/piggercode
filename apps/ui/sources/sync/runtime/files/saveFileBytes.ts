import { Platform } from 'react-native';

import { createNativeCacheFileSink, shareNativeCacheFile } from '@/sync/runtime/files/nativeCacheFileSink';
import { t } from '@/text';

/**
 * Hands bytes to the user as a file: a browser download on the web, the share sheet (save to Files, AirDrop…)
 * on phones, where the cached copy is removed again unless the share keeps it.
 */
export async function saveFileBytes(params: Readonly<{
    name: string;
    bytes: Uint8Array;
    mimeType: string;
    /** The share sheet's title on phones. */
    dialogTitle: string;
}>): Promise<void> {
    if (
        Platform.OS === 'web'
        && typeof document !== 'undefined'
        && typeof Blob !== 'undefined'
        && typeof URL !== 'undefined'
        && typeof URL.createObjectURL === 'function'
    ) {
        const href = URL.createObjectURL(new Blob([params.bytes as BlobPart], { type: params.mimeType }));
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = params.name;
        anchor.rel = 'noopener noreferrer';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        return;
    }

    const created = await createNativeCacheFileSink({ directoryName: 'happier-downloads', name: params.name });
    if (!created.ok) throw new Error(created.error);
    let retainCacheFile = false;
    try {
        await created.sink.writeBytes(params.bytes);
        await created.sink.close();
        const result = await shareNativeCacheFile({
            fileUri: created.sink.fileUri,
            name: params.name,
            mimeType: params.mimeType,
            dialogTitle: params.dialogTitle,
        });
        if (result.status === 'unavailable') throw new Error(t('files.fileSharingUnavailable'));
        if (result.status === 'shared') retainCacheFile = result.retainCacheFile;
    } finally {
        if (!retainCacheFile) await created.sink.cleanup();
    }
}

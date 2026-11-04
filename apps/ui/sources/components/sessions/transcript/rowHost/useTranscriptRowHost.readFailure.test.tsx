import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { resolveMainTranscriptListShellFrame } from '@/components/sessions/transcript/viewport/shell/transcriptListShellCapabilities';
import type { SessionTranscriptReadFailure } from '@/sync/store/domains/transcriptLoading';

import { useTranscriptItemsEdgeSlots } from './useTranscriptRowHost';

const REASON = 'Codex history could not be read completely: Codex native history contains an unsupported transcript item';

function UnreadableTranscript(props: Readonly<{
    failure: SessionTranscriptReadFailure | null;
    onRetry: () => Promise<void>;
}>) {
    const slots = useTranscriptItemsEdgeSlots({
        bottomNotice: null,
        composerInsetHeight: 0,
        controlSwitchTo: null,
        controlledByUserOverride: undefined,
        directControlFooter: undefined,
        handleComposerInsetHeightChange: () => {},
        handleNativeHotTailHeightChange: () => {},
        isLoadingOlder: false,
        mainTranscriptListShellFrame: resolveMainTranscriptListShellFrame({ platformOS: 'web' }),
        onRequestSwitchToRemote: undefined,
        olderPaginationIsLoadingOlder: false,
        // What the reader saw: an older read that never answers kept "Earlier messages" up.
        olderPaginationCanContinue: true,
        onContinueOlderPagination: () => {},
        onRetryTranscriptRead: props.onRetry,
        prependRangeReservePx: 0,
        renderTranscriptItemAtIndex: () => null,
        sessionId: 'unreadable-transcript',
        shouldUseNativeHotColdSplit: false,
        shouldUseWebHotColdSplit: false,
        showCatchUpOverlay: false,
        showFirstPaintPlaceholder: false,
        transcriptHotColdSegments: {
            active: false, coldCount: 0, coldItems: [], hotCount: 0, hotItems: [],
            hotItemsCanonical: [], nativeEdgeSlotItems: [], splitIndex: 0, webFooterItems: [],
        },
        transcriptOlderLoadSpinnerDelayMs: 0,
        transcriptReadFailure: props.failure,
    });
    return slots.olderLoadOverlay;
}

describe('a transcript the machine could not read', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('says the history could not be read, offers a retry, and keeps the reason behind Details', async () => {
        const retry = vi.fn(async () => {});
        const screen = await renderScreen(
            <UnreadableTranscript failure={{ code: 'provider_unavailable', message: REASON, failedAt: 1 }} onRetry={retry} />,
        );

        expect(screen.findByTestId('transcript-older-load-continue')).toBeNull();
        expect(screen.findByTestId('transcript-read-failure')).not.toBeNull();
        expect(screen.getTextContent()).not.toContain(REASON);

        await screen.pressByTestIdAsync('transcript-read-failure-details');
        expect(screen.getTextContent()).toContain(REASON);

        await screen.pressByTestIdAsync('transcript-read-failure-retry');
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('keeps the ordinary continuation when nothing failed', async () => {
        const screen = await renderScreen(<UnreadableTranscript failure={null} onRetry={async () => {}} />);
        expect(screen.findByTestId('transcript-read-failure')).toBeNull();
        expect(screen.findByTestId('transcript-older-load-continue')).not.toBeNull();
    });
});

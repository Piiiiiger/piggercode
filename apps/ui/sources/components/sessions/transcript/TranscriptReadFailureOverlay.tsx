import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import type { SessionTranscriptReadFailure } from '@/sync/store/domains/transcriptLoading';
import { t } from '@/text';

/**
 * What an empty transcript says when the machine answered that it cannot read the session's
 * history. It replaces the "Earlier messages" continuation, which could only ever load nothing.
 * Retry reads again at once; the machine's own reason stays behind Details for support.
 */
export const TranscriptReadFailureOverlay = React.memo(function TranscriptReadFailureOverlay(props: Readonly<{
    failure: SessionTranscriptReadFailure;
    onRetry: () => Promise<void>;
}>) {
    const { theme } = useUnistyles();
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const detailsTitle = detailsOpen ? t('session.transcriptReadFailure.hideDetails') : t('common.details');
    return (
        <View
            testID="transcript-read-failure"
            pointerEvents="box-none"
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 2, justifyContent: 'center', paddingHorizontal: 24 }}
        >
            <EmptyState
                icon={<Icon name="warning-circle" size={29} color={theme.colors.text.secondary} />}
                title={t('session.transcriptReadFailure.title')}
                subtitle={props.failure.code === 'machine_offline'
                    ? t('session.transcriptReadFailure.offlineBody')
                    : t('session.transcriptReadFailure.body')}
                action={(
                    <View style={{ alignItems: 'center', gap: 12 }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <RoundButton
                                testID="transcript-read-failure-retry"
                                size="normal"
                                title={t('common.retry')}
                                accessibilityLabel={t('common.retry')}
                                action={props.onRetry}
                            />
                            <RoundButton
                                testID="transcript-read-failure-details"
                                size="normal"
                                display="inverted"
                                title={detailsTitle}
                                accessibilityLabel={detailsTitle}
                                onPress={() => setDetailsOpen((open) => !open)}
                            />
                        </View>
                        {detailsOpen ? (
                            <Text selectable style={{ color: theme.colors.text.secondary, textAlign: 'center' }}>
                                {props.failure.message}
                            </Text>
                        ) : null}
                    </View>
                )}
            />
        </View>
    );
});

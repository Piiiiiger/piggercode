import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { t } from '@/text';

import type { SharedFolderModalProps } from './SharedFolderModal';

// The window pulls in the machine file browser, so it loads on first open, like the path picker.
const LazySharedFolderModal = React.lazy(async () => {
    const module = await import('./SharedFolderModal');
    return { default: module.SharedFolderModal };
});

const stylesheet = StyleSheet.create(() => ({
    loading: {
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

function SharedFolderLoading(props: Pick<SharedFolderModalProps, 'setChrome' | 'location'>) {
    const { theme } = useUnistyles();
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('files.sharedFolder.title'),
        subtitle: props.location.displayPath,
        dimensions: { width: 560, maxHeightRatio: 0.92 },
    }), [props.location.displayPath]);
    useModalCardChrome(props.setChrome, chrome);

    return (
        <View style={stylesheet.loading}>
            <ActivitySpinner
                size="small"
                color={theme.colors.text.secondary}
                accessibilityRole="progressbar"
                accessibilityLabel={t('common.loading')}
            />
        </View>
    );
}

export function SharedFolderModalEntry(props: SharedFolderModalProps) {
    return (
        <React.Suspense fallback={<SharedFolderLoading setChrome={props.setChrome} location={props.location} />}>
            <LazySharedFolderModal {...props} />
        </React.Suspense>
    );
}

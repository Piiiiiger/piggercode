import * as React from 'react';
import { Image, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useCodeLinesSyntaxHighlighting } from '@/components/ui/code/highlighting/useCodeLinesSyntaxHighlighting';
import { buildCodeLinesFromFile } from '@/components/ui/code/model/buildCodeLinesFromFile';
import { CodeLinesView } from '@/components/ui/code/view/CodeLinesView';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { machineReadFile } from '@/sync/ops/machines';
import { t } from '@/text';

import { isMachineFilePreviewBinaryByName, resolveMachineFilePreview, type MachineFilePreview } from './machineFilePreview';

// The machine's readFile refuses files above its read limit with this message.
const MACHINE_READ_TOO_LARGE_ERROR = 'File is too large to read';

type PreviewState =
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'ready'; preview: MachineFilePreview }>
    | Readonly<{ status: 'error'; message: string }>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    path: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.mono(),
    },
    centered: {
        flex: 1,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        padding: 24,
        gap: 8,
    },
    note: {
        fontSize: 14,
        textAlign: 'center' as const,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    image: {
        flex: 1,
        margin: 16,
    },
}));

export type MachineFilePreviewViewProps = Readonly<{
    machineId: string;
    serverId: string | null;
    /** Absolute path of the file on the machine. */
    path: string;
}>;

/** A read-only look at one file on a machine: text with syntax highlighting, a picture, or why it cannot show. */
export function MachineFilePreviewView(props: MachineFilePreviewViewProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { machineId, path, serverId } = props;
    const fileName = path.slice(path.lastIndexOf('/') + 1) || path;
    const [state, setState] = React.useState<PreviewState>({ status: 'loading' });

    React.useEffect(() => {
        let cancelled = false;
        if (isMachineFilePreviewBinaryByName(path)) {
            setState({ status: 'ready', preview: { kind: 'binary' } });
            return;
        }
        setState({ status: 'loading' });
        void machineReadFile(machineId, path, { serverId }).then((result) => {
            if (cancelled) return;
            if (!result.success) {
                setState({
                    status: 'error',
                    message: result.error === MACHINE_READ_TOO_LARGE_ERROR ? t('files.fileTooLargeToPreview') : result.error,
                });
                return;
            }
            setState({ status: 'ready', preview: resolveMachineFilePreview(path, result.contentBase64) });
        });
        return () => {
            cancelled = true;
        };
    }, [machineId, path, serverId]);

    const text = state.status === 'ready' && state.preview.kind === 'text' ? state.preview.text : null;
    const lines = React.useMemo(() => (text === null ? [] : buildCodeLinesFromFile({ text })), [text]);
    const syntaxHighlighting = useCodeLinesSyntaxHighlighting(path);

    let body: React.ReactNode;
    if (state.status === 'loading') {
        body = (
            <View style={styles.centered}>
                <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                <Text style={styles.note}>{t('files.loadingFile', { fileName })}</Text>
            </View>
        );
    } else if (state.status === 'error') {
        body = (
            <View style={styles.centered} testID="machine-file-preview-error">
                <Text style={styles.note}>{state.message}</Text>
            </View>
        );
    } else if (state.preview.kind === 'image') {
        body = (
            <Image
                testID="machine-file-preview-image"
                source={{ uri: state.preview.uri }}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel={fileName}
            />
        );
    } else if (state.preview.kind === 'binary') {
        body = (
            <View style={styles.centered} testID="machine-file-preview-binary">
                <Text style={styles.note}>{t('files.cannotDisplayBinary')}</Text>
            </View>
        );
    } else {
        body = (
            <CodeLinesView
                lines={lines}
                virtualized
                showLineNumbers
                wrapLines={false}
                syntaxHighlighting={syntaxHighlighting}
                contentPaddingHorizontal={16}
                contentPaddingVertical={12}
                testID="machine-file-preview-code"
            />
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle" selectable>
                {path}
            </Text>
            {body}
        </View>
    );
}

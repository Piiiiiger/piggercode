import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { MachinePathBrowserView } from '@/components/ui/pathBrowser/MachinePathBrowserModal';
import { RepositoryTreeDropOverlay } from '@/components/sessions/files/repositoryTree/RepositoryTreeDropOverlay';
import { RepositoryTreeTransferStatusBar } from '@/components/sessions/files/repositoryTree/RepositoryTreeTransferStatusBar';
import { WebDropTargetView } from '@/components/sessions/files/repositoryTree/WebDropTargetView';
import { showUploadConflictResolutionDialog } from '@/components/sessions/files/repositoryTree/showUploadConflictResolutionDialog';
import { Typography } from '@/constants/Typography';
import { useWorkspaceFileTransfers, type WorkspaceUploadEntry } from '@/hooks/session/files/useWorkspaceFileTransfers';
import { useWebFileDropZone } from '@/hooks/ui/useWebFileDropZone';
import { Modal, type CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { machineCreateDirectory } from '@/sync/ops/machines';
import { t } from '@/text';
import { nativePickFiles, type NativePickedFile } from '@/utils/files/nativePickFiles';
import { readWebDroppedEntries } from '@/utils/files/webDroppedEntries';

import type { SharedFolderLocation } from './sharedFolderLocation';

export const SHARED_FOLDER_MODAL_TEST_ID = 'shared-folder-modal';

export type SharedFolderModalProps = CustomModalInjectedProps & Readonly<{
    sessionId: string;
    machineId: string;
    serverId: string | null;
    location: SharedFolderLocation;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        minHeight: 0,
        position: 'relative',
    },
    footer: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    preparing: {
        flex: 1,
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hint: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
}));

const isWeb = Platform.OS === 'web';

/**
 * The shared folder on the session's machine: click a file to download it, drop files (or use
 * Upload files) to put them there. Uploads keep folder structure and ask before replacing.
 */
export function SharedFolderModal(props: SharedFolderModalProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const folderPath = props.location.absolutePath;
    const [folderReady, setFolderReady] = React.useState(false);
    const [refreshNonce, setRefreshNonce] = React.useState(0);
    const [fileDragActive, setFileDragActive] = React.useState(false);
    const webFileInputRef = React.useRef<HTMLInputElement | null>(null);

    // The shared folder may not exist until the first upload; create it so the window opens on an
    // empty folder rather than an error. If the machine is unreachable the listing shows that.
    React.useEffect(() => {
        let cancelled = false;
        setFolderReady(false);
        void machineCreateDirectory(props.machineId, folderPath, { serverId: props.serverId })
            .finally(() => {
                if (!cancelled) setFolderReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [folderPath, props.machineId, props.serverId]);

    const reloadListing = React.useCallback(() => setRefreshNonce((n) => n + 1), []);
    const transfers = useWorkspaceFileTransfers({
        sessionId: props.sessionId,
        onResolveUploadConflicts: showUploadConflictResolutionDialog,
        onAfterUploadSuccess: reloadListing,
    });

    const upload = React.useCallback(async (entries: readonly WorkspaceUploadEntry[]) => {
        if (entries.length === 0) return;
        const result = await transfers.startUploads({ entries, destinationDir: folderPath, destinationIsAbsolute: true });
        if (!result.ok && !result.canceled && result.error !== 'Upload canceled') {
            Modal.alert(t('common.error'), result.error);
        }
    }, [folderPath, transfers.startUploads]);

    const handleFilesDropped = React.useCallback(async (event: { dataTransfer?: unknown }) => {
        if (!event?.dataTransfer) return;
        const dropped = await readWebDroppedEntries(event.dataTransfer);
        await upload(dropped.map((entry) => ({ kind: 'web' as const, file: entry.file, relativePath: entry.relativePath })));
    }, [upload]);

    const dropZoneHandlers = useWebFileDropZone({
        enabled: isWeb,
        onFileDragActiveChange: setFileDragActive,
        onFilesDropped: handleFilesDropped,
    });

    const pickFiles = React.useCallback(async () => {
        if (isWeb) {
            webFileInputRef.current?.click();
            return;
        }
        const picked = await nativePickFiles({ multiple: true });
        const nativePicked = picked.filter((file): file is Extract<NativePickedFile, { kind: 'native' }> => file.kind === 'native');
        await upload(nativePicked.map((file) => ({
            kind: 'native' as const,
            uri: file.uri,
            name: file.name,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            relativePath: file.name,
        })));
    }, [upload]);

    const download = React.useCallback((path: string) => {
        void transfers.startDownload({ path, asZip: false }).then((result) => {
            if (!result.ok && !result.canceled) {
                Modal.alert(t('common.error'), result.error);
            }
        });
    }, [transfers.startDownload]);

    const uploading = transfers.uploadState.status === 'preflighting' || transfers.uploadState.status === 'uploading';
    const footer = React.useMemo(() => (
        <View style={styles.footer}>
            <Text style={styles.hint}>{isWeb ? t('files.sharedFolder.hintWeb') : t('files.sharedFolder.hintNative')}</Text>
            <RoundButton
                testID="shared-folder-upload"
                title={t('files.sharedFolder.upload')}
                size="normal"
                onPress={() => { void pickFiles(); }}
                disabled={uploading}
            />
        </View>
    ), [pickFiles, styles.footer, styles.hint, uploading]);

    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        title: t('files.sharedFolder.title'),
        subtitle: props.location.displayPath,
        testID: SHARED_FOLDER_MODAL_TEST_ID,
        footer,
        layout: 'fill' as const,
        dimensions: { width: 560, maxHeightRatio: 0.92, size: 'md' as const },
    }), [footer, props.location.displayPath]);
    useModalCardChrome(props.setChrome, chrome);

    return (
        <WebDropTargetView testID="shared-folder-drop-zone" style={styles.body} {...dropZoneHandlers}>
            {isWeb ? (
                <input
                    ref={webFileInputRef}
                    data-testid="shared-folder-upload-input"
                    type="file"
                    style={{ display: 'none' }}
                    multiple
                    onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        event.target.value = '';
                        void upload(files.map((file) => ({ kind: 'web' as const, file, relativePath: file.name })));
                    }}
                />
            ) : null}
            {folderReady ? (
                <MachinePathBrowserView
                    machineId={props.machineId}
                    serverId={props.serverId}
                    rootDirectoryPath={folderPath}
                    includeFiles
                    selectionMode="file"
                    variant="popover"
                    interaction="immediate"
                    emptyLabel={t('files.sharedFolder.empty')}
                    refreshNonce={refreshNonce}
                    onPickPath={download}
                />
            ) : (
                <View style={styles.preparing} testID="shared-folder-preparing">
                    <ActivitySpinner
                        size="small"
                        color={theme.colors.text.secondary}
                        accessibilityRole="progressbar"
                        accessibilityLabel={t('common.loading')}
                    />
                </View>
            )}
            <RepositoryTreeTransferStatusBar
                uploadState={transfers.uploadState}
                downloadState={transfers.downloadState}
                onCancelUploads={transfers.cancelUploads}
                onCancelDownload={transfers.cancelDownload}
            />
            <RepositoryTreeDropOverlay visible={fileDragActive} destinationLabel={props.location.displayPath} />
        </WebDropTargetView>
    );
}

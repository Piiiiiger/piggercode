import * as React from 'react';

import { namePastedImage } from '@/components/sessions/attachments/namePastedImage';
import { useAttachmentsUploadConfig } from '@/components/sessions/attachments/useAttachmentsUploadConfig';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import { useMachineTerminalSession } from '@/hooks/machine/useMachineTerminalSession';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import { getAppInstallId } from '@/sync/domains/state/appInstallId';
import { sessionAttachmentsUploadFile } from '@/sync/domains/transfers/ops/uploadSessionAttachment';
import { sessionRecordTerminalInput } from '@/sync/ops/sessionTerminalInput';
import { t } from '@/text';
import type { SessionTerminalMode } from './sessionTerminalMode';

export function useSessionEmbeddedTerminalPty(params: Readonly<{
    sessionId: string;
    terminalKey: string;
    terminalMode: SessionTerminalMode;
    terminalRef: React.MutableRefObject<EmbeddedTerminalRendererHandle | null>;
    /** Whether this terminal's screen is the one shown; a covered view does not take the session's window. */
    viewFocused?: boolean;
}>) {
    const machineTarget = useSessionMachineTarget(params.sessionId);
    const { machineReachable, machineRpcTargetAvailable } = useSessionMachineReachability(params.sessionId);
    // Each app install attaches on its own (its own tmux client), so the session's window takes the size of the
    // device in use instead of every device resizing one shared terminal.
    const viewerId = React.useMemo(() => getAppInstallId(), []);
    const launch = React.useMemo(
        () => params.terminalMode === 'session_attach'
            ? { kind: 'session_attach' as const, sessionId: params.sessionId, ...(viewerId ? { viewerId } : {}) }
            : null,
        [params.sessionId, params.terminalMode, viewerId],
    );

    const controller = useMachineTerminalSession({
        machineId: machineTarget?.machineId ?? null,
        cwd: params.terminalMode === 'workspace_shell' ? machineTarget?.basePath ?? null : null,
        launch,
        machineReachable,
        machineRpcTargetAvailable,
        terminalKey: params.terminalKey,
        terminalRef: params.terminalRef,
        viewFocused: params.viewFocused,
    });

    const { sessionId } = params;
    // Enter sends what the user typed to the session's CLI: the session is in use now, for the 「最近」
    // box, the list's order and every device, whatever its runner reports. A shell in its folder is not.
    const { onInput: sendInput } = controller;
    const recordsUse = params.terminalMode === 'session_attach';
    const onInput = React.useCallback((data: string) => {
        sendInput(data);
        if (recordsUse && data.includes('\r')) sessionRecordTerminalInput(sessionId);
    }, [recordsUse, sendInput, sessionId]);

    // Pasted images go where chat attachments go (the attachment settings), then their paths are typed.
    const uploadConfig = useAttachmentsUploadConfig();
    const terminalKeyRef = React.useRef(params.terminalKey);
    terminalKeyRef.current = params.terminalKey;
    const onPasteImages = React.useCallback(async (images: readonly File[]): Promise<readonly string[]> => {
        const terminalKey = terminalKeyRef.current;
        const now = new Date();
        const paths: string[] = [];
        for (const [index, image] of images.entries()) {
            const uploaded = await sessionAttachmentsUploadFile({
                sessionId,
                file: { kind: 'web', file: namePastedImage(image, index, now) },
                messageLocalId: randomUUID(),
                config: uploadConfig,
            });
            if (!uploaded.success) {
                Modal.alert(t('terminalEmbedded.pasteImageFailed'), uploaded.error);
                break;
            }
            paths.push(uploaded.path);
        }
        // The pane may show the session's other terminal by now (Agent CLI or shell): nothing is typed there.
        return terminalKeyRef.current === terminalKey ? paths : [];
    }, [sessionId, uploadConfig]);

    return { ...controller, onInput, onPasteImages };
}

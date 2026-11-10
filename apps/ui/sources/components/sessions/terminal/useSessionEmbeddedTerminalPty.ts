import * as React from 'react';

import { useAttachmentsUploadConfig } from '@/components/sessions/attachments/useAttachmentsUploadConfig';
import { useSessionMachineReachability } from '@/components/sessions/model/useSessionMachineReachability';
import { useSessionMachineTarget } from '@/components/sessions/model/useSessionMachineTarget';
import type { EmbeddedTerminalRendererHandle } from '@/components/sessions/terminal/embeddedTerminalRendererHandle';
import { useMachineTerminalSession } from '@/hooks/machine/useMachineTerminalSession';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import { sessionAttachmentsUploadFile } from '@/sync/domains/transfers/ops/uploadSessionAttachment';
import { t } from '@/text';
import type { SessionTerminalMode } from './sessionTerminalMode';

/**
 * A name of its own for a pasted image (screenshots all arrive as "image.png"), so uploads never
 * collide and the typed path has no spaces.
 */
function namePastedImage(image: File, index: number, now: Date): File {
    const subtype = image.type.slice('image/'.length).replace(/\+.*$/, '').replace(/^jpeg$/, 'jpg') || 'png';
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
    return new File([image], `pasted-${stamp}-${now.getMilliseconds()}-${index + 1}.${subtype}`, { type: image.type });
}

export function useSessionEmbeddedTerminalPty(params: Readonly<{
    sessionId: string;
    terminalKey: string;
    terminalMode: SessionTerminalMode;
    terminalRef: React.MutableRefObject<EmbeddedTerminalRendererHandle | null>;
}>) {
    const machineTarget = useSessionMachineTarget(params.sessionId);
    const { machineReachable, machineRpcTargetAvailable } = useSessionMachineReachability(params.sessionId);
    const launch = React.useMemo(
        () => params.terminalMode === 'session_attach'
            ? { kind: 'session_attach' as const, sessionId: params.sessionId }
            : null,
        [params.sessionId, params.terminalMode],
    );

    const controller = useMachineTerminalSession({
        machineId: machineTarget?.machineId ?? null,
        cwd: params.terminalMode === 'workspace_shell' ? machineTarget?.basePath ?? null : null,
        launch,
        machineReachable,
        machineRpcTargetAvailable,
        terminalKey: params.terminalKey,
        terminalRef: params.terminalRef,
    });

    // Pasted images go where chat attachments go (the attachment settings), then their paths are typed.
    const uploadConfig = useAttachmentsUploadConfig();
    const { sessionId } = params;
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

    return { ...controller, onPasteImages };
}

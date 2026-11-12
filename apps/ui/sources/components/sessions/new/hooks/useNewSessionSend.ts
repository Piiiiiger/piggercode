import * as React from 'react';

import type { AgentInputAttachment } from '@/components/sessions/agentInput/agentInputContracts';
import type { AgentInputSendOptions } from '@/components/sessions/agentInput/agentInputSendOptions';
import { namePastedImage } from '@/components/sessions/attachments/namePastedImage';
import { useAttachmentsUploadConfig } from '@/components/sessions/attachments/useAttachmentsUploadConfig';
import type { NewSessionPromptStore } from '@/components/sessions/new/hooks/screenModel/newSessionPromptStore';
import type { HandleCreateSessionOptions } from '@/components/sessions/new/hooks/useCreateNewSession';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import { sessionAttachmentsUploadFile } from '@/sync/domains/transfers/ops/uploadSessionAttachment';
import { resolveMachinePathFromSessionBase } from '@/sync/ops/sessionMachineTarget';
import { t } from '@/text';
import { resolveAbsolutePath } from '@/utils/path/pathUtils';
import { blurActiveElementOnWeb, deferOnWeb } from '@/utils/platform/deferOnWeb';

/** The computer and folder the session will start in: where its images go first. */
export type NewSessionSendTarget = Readonly<{
    machineId: string | null;
    serverId: string | null;
    /** Absolute on that computer (a `~` folder is resolved with its home). */
    directory: string;
}>;

export function resolveNewSessionSendTarget(params: Readonly<{
    machineId: string | null;
    serverId: string | null;
    path: string;
    homeDir: string | null;
}>): NewSessionSendTarget {
    return {
        machineId: params.machineId,
        serverId: params.serverId,
        directory: resolveAbsolutePath(params.path, params.homeDir ?? undefined),
    };
}

function sendTargetKey(target: NewSessionSendTarget | undefined): string {
    return JSON.stringify([target?.serverId ?? null, target?.machineId ?? null, target?.directory ?? '']);
}

type NewSessionImage = Readonly<{
    key: string;
    file: File;
    previewUri: string | null;
    status: 'pending' | 'uploading' | 'uploaded' | 'error';
    progress?: Readonly<{ uploadedBytes: number; totalBytes: number }>;
    error?: string;
    /** Where it is on the computer once uploaded, kept for another try at starting the session there. */
    uploaded?: Readonly<{ path: string; targetKey: string }>;
}>;

/** The first prompt: the typed text, then each image's path on the session's computer on a line of its own. */
export function withImagePaths(text: string, paths: readonly string[]): string {
    if (paths.length === 0) return text;
    const body = text.trimEnd();
    return body ? `${body}\n\n${paths.join('\n')}` : paths.join('\n');
}

function createPreviewUri(file: File): string | null {
    try {
        return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
    } catch {
        return null;
    }
}

function revokePreviewUri(uri: string | null): void {
    if (uri && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(uri);
}

/**
 * Sends the new-session screen: the session starts as the CLI's own terminal, with the text typed
 * here (if any) as its first prompt. Images pasted or dropped here are put on the session's
 * computer first (where attachments go, as in a terminal), and their absolute paths end the first
 * prompt: Claude and Codex both read an image from its path. What starts is what the composer
 * shows when the uploads end; images stay until the screen closes on a started session, so another
 * try after a failed start does not upload them again. A launch the screen was making when it
 * reloaded goes on once.
 */
export function useNewSessionSend(params: Readonly<{
    promptStore: NewSessionPromptStore;
    handleCreateSession: (opts?: HandleCreateSessionOptions) => void;
    resumePersistedLaunchKey?: string | null;
    /** Read when sending and again before starting: the computer and folder the launch itself will use. */
    getSendTarget?: () => NewSessionSendTarget;
}>): Readonly<{
    onSend: (options?: AgentInputSendOptions) => void;
    attachments: readonly AgentInputAttachment[];
    onAttachmentsAdded: (files: readonly File[]) => void;
    /** The screen is leaving: an upload under way starts no session when it ends. */
    cancelPendingSend: () => void;
}> {
    const { promptStore, handleCreateSession } = params;
    const uploadConfig = useAttachmentsUploadConfig();
    // The ref is the images' source of truth (an upload reads what the composer shows right now);
    // the state renders it.
    const imagesRef = React.useRef<readonly NewSessionImage[]>([]);
    const [images, setImagesState] = React.useState<readonly NewSessionImage[]>(imagesRef.current);
    const setImages = React.useCallback((update: (current: readonly NewSessionImage[]) => readonly NewSessionImage[]) => {
        imagesRef.current = update(imagesRef.current);
        setImagesState(imagesRef.current);
    }, []);
    const getSendTargetRef = React.useRef(params.getSendTarget);
    getSendTargetRef.current = params.getSendTarget;
    const uploadingRef = React.useRef(false);
    const mountedRef = React.useRef(true);
    const sendGenerationRef = React.useRef(0);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            for (const image of imagesRef.current) revokePreviewUri(image.previewUri);
        };
    }, []);

    const updateImage = React.useCallback((key: string, patch: Partial<NewSessionImage>) => {
        setImages((current) => current.map((image) => (image.key === key ? { ...image, ...patch } : image)));
    }, [setImages]);

    const createSession = React.useCallback((
        options: AgentInputSendOptions | undefined,
        promptText: string,
        carriesText: boolean,
        stillCurrent?: () => boolean,
    ) => {
        // The composer's `mentions[]` envelope goes along with the text.
        const structuredInputMetaOverrides = options?.structuredInputMetaOverrides;
        const opts = carriesText || structuredInputMetaOverrides
            ? {
                ...(carriesText ? { inputTextOverride: promptText } : {}),
                ...(structuredInputMetaOverrides ? { structuredInputMetaOverrides } : {}),
            }
            : undefined;
        blurActiveElementOnWeb();
        deferOnWeb(() => {
            // Asked again when the launch runs, a frame later on web.
            if (stillCurrent && !stillCurrent()) return;
            handleCreateSession(opts);
        });
    }, [handleCreateSession]);

    const uploadThenCreate = React.useCallback(async (options: AgentInputSendOptions | undefined, promptText: string) => {
        const target = getSendTargetRef.current?.();
        const machineId = target?.machineId;
        if (!target || !machineId) {
            Modal.alert(t('newSession.imageUploadFailed'), t('newSession.noMachineSelected'));
            return;
        }
        const targetKey = sendTargetKey(target);
        const generation = sendGenerationRef.current;
        // Leaving or closed meanwhile: nothing starts. Another computer or folder meanwhile: the next send puts the images there.
        const stillCurrent = () => mountedRef.current
            && sendGenerationRef.current === generation
            && sendTargetKey(getSendTargetRef.current?.()) === targetKey;
        uploadingRef.current = true;
        try {
            for (;;) {
                const image = imagesRef.current.find((candidate) => candidate.uploaded?.targetKey !== targetKey);
                if (!image) break;
                updateImage(image.key, { status: 'uploading', progress: undefined, error: undefined, uploaded: undefined });
                const uploaded = await sessionAttachmentsUploadFile({
                    machine: { machineId, serverId: target.serverId, directory: target.directory },
                    file: { kind: 'web', file: image.file },
                    messageLocalId: randomUUID(),
                    config: uploadConfig,
                    onProgress: (progress) => updateImage(image.key, { progress }),
                });
                if (!mountedRef.current) return;
                if (!uploaded.success) {
                    // Taken out of the composer meanwhile: its failure no longer matters.
                    if (!imagesRef.current.some((current) => current.key === image.key)) continue;
                    updateImage(image.key, { status: 'error', progress: undefined, error: uploaded.error });
                    Modal.alert(t('newSession.imageUploadFailed'), uploaded.error);
                    return;
                }
                // Workspace uploads answer a path inside the folder: the session may start elsewhere (a worktree).
                const path = resolveMachinePathFromSessionBase({ basePath: target.directory, requestPath: uploaded.path });
                updateImage(image.key, { status: 'uploaded', progress: undefined, uploaded: { path, targetKey } });
            }
        } finally {
            uploadingRef.current = false;
        }
        if (!stillCurrent()) return;
        const paths = imagesRef.current.flatMap((image) => (image.uploaded ? [image.uploaded.path] : []));
        createSession(options, withImagePaths(promptText, paths), true, stillCurrent);
    }, [createSession, updateImage, uploadConfig]);

    const submit = React.useCallback((options: AgentInputSendOptions | undefined, capturePromptAtDispatch: boolean) => {
        if (uploadingRef.current) return;
        const promptText = options?.inputTextOverride ?? promptStore.getPrompt();
        if (imagesRef.current.length > 0) {
            void uploadThenCreate(options, promptText);
            return;
        }
        createSession(options, promptText, Boolean(options?.inputTextOverride || (capturePromptAtDispatch && promptText)));
    }, [createSession, promptStore, uploadThenCreate]);

    const resumedPersistedLaunchKeyRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const key = params.resumePersistedLaunchKey?.trim() ?? '';
        if (key.length === 0 || resumedPersistedLaunchKeyRef.current === key) return;
        resumedPersistedLaunchKeyRef.current = key;
        submit(undefined, false);
    }, [params.resumePersistedLaunchKey, submit]);

    const onSend = React.useCallback((options?: AgentInputSendOptions) => {
        submit(options, true);
    }, [submit]);

    const cancelPendingSend = React.useCallback(() => {
        sendGenerationRef.current += 1;
    }, []);

    const onAttachmentsAdded = React.useCallback((files: readonly File[]) => {
        const added = files.filter((file) => file.type.startsWith('image/'));
        if (added.length < files.length) Modal.alert(t('newSession.imagesOnly'));
        if (added.length === 0) return;
        const now = new Date();
        const base = imagesRef.current.length;
        const next = added.map((file, index): NewSessionImage => {
            const named = namePastedImage(file, base + index, now);
            return { key: randomUUID(), file: named, previewUri: createPreviewUri(named), status: 'pending' };
        });
        setImages((current) => [...current, ...next]);
    }, [setImages]);

    const removeImage = React.useCallback((key: string) => {
        const removed = imagesRef.current.find((image) => image.key === key);
        if (removed) revokePreviewUri(removed.previewUri);
        setImages((current) => current.filter((image) => image.key !== key));
    }, [setImages]);

    const attachments = React.useMemo<readonly AgentInputAttachment[]>(() => images.map((image) => ({
        key: image.key,
        label: image.file.name,
        status: image.status,
        ...(image.previewUri ? { preview: { kind: 'image' as const, uri: image.previewUri } } : {}),
        ...(image.progress ? { uploadProgress: image.progress } : {}),
        ...(image.error ? { error: image.error } : {}),
        onRemove: () => removeImage(image.key),
    })), [images, removeImage]);

    return { onSend, attachments, onAttachmentsAdded, cancelPendingSend };
}

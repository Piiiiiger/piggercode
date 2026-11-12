import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import type { NewSessionSendTarget } from './useNewSessionSend';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uploadToMachineSpy = vi.hoisted(() => vi.fn());
const alertSpy = vi.hoisted(() => vi.fn());

// The machine end of an upload: the chunked transfer to the computer the session will run on.
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/transfers/runtime/bulkTransferPipeline')>()),
    uploadDaemonSessionAttachmentFromReader: (...args: unknown[]) => uploadToMachineSpy(...args),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: (...args: unknown[]) => alertSpy(...args) },
}));

// Settings left unset: the attachment defaults apply.
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({});
});

type UploadCall = Readonly<{
    machine?: NewSessionSendTarget;
    sessionId?: string;
    request: Readonly<{ fileName: string; uploadLocation: string; sharedFolderPath?: string }>;
}>;

const target: NewSessionSendTarget = { machineId: 'machine-1', serverId: 'server-1', directory: '/home/me/project' };
const otherComputer: NewSessionSendTarget = { machineId: 'machine-2', serverId: 'server-1', directory: '/home/me/project' };

async function renderNewSessionSend(prompt: string) {
    const { useNewSessionSend } = await import('./useNewSessionSend');
    const { createNewSessionPromptStore } = await import('./screenModel/newSessionPromptStore');
    const handleCreateSession = vi.fn();
    const promptStore = createNewSessionPromptStore(prompt);
    const hook = await renderHook(
        (props: Readonly<{ target: NewSessionSendTarget }>) => useNewSessionSend({ promptStore, handleCreateSession, getSendTarget: () => props.target }),
        { initialProps: { target } },
    );
    return { hook, handleCreateSession };
}

function screenshot(): File {
    return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png', { type: 'image/png' });
}

function photo(): File {
    return new File([new Uint8Array([255, 216, 255, 224])], 'photo.jpg', { type: 'image/jpeg' });
}

function uploadsTo(folder: string) {
    return async (call: UploadCall) => ({ success: true, path: `${folder}${call.request.fileName}`, sizeBytes: 8, sha256: 'digest' });
}

function heldUpload() {
    let finish: (() => void) | null = null;
    uploadToMachineSpy.mockImplementationOnce((call: UploadCall) => new Promise((resolve) => {
        finish = () => resolve({ success: true, path: `/home/me/Downloads/${call.request.fileName}`, sizeBytes: 8, sha256: 'digest' });
    }));
    return { started: () => finish !== null, finish: () => finish!() };
}

describe('useNewSessionSend images', () => {
    beforeEach(() => {
        uploadToMachineSpy.mockReset();
        alertSpy.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('puts a pasted image on the computer the session starts on, and ends the first prompt with its path', async () => {
        uploadToMachineSpy.mockImplementation(uploadsTo('/home/me/Downloads/'));
        const { hook, handleCreateSession } = await renderNewSessionSend('What is wrong here?');

        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        expect(hook.getCurrent().attachments).toHaveLength(1);
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));

        const call = uploadToMachineSpy.mock.calls[0]![0] as UploadCall;
        expect(call.machine).toEqual(target);
        expect(call.sessionId).toBeUndefined();
        expect(call.request).toMatchObject({ uploadLocation: 'shared_folder', sharedFolderPath: '~/Downloads' });
        expect(call.request.fileName).toMatch(/^pasted-\d{8}-\d{6}-\d+-1\.png$/);
        expect(handleCreateSession).toHaveBeenCalledWith({
            inputTextOverride: `What is wrong here?\n\n/home/me/Downloads/${call.request.fileName}`,
        });
        expect(hook.getCurrent().attachments).toEqual([expect.objectContaining({ status: 'uploaded' })]);
    });

    it('tries again with the images it already put on the computer, without uploading them again', async () => {
        uploadToMachineSpy.mockImplementation(uploadsTo('/home/me/Downloads/'));
        const { hook, handleCreateSession } = await renderNewSessionSend('again');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });

        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(2));

        expect(uploadToMachineSpy).toHaveBeenCalledTimes(1);
        expect(handleCreateSession.mock.calls[1]).toEqual(handleCreateSession.mock.calls[0]);
    });

    it('gives the agent an absolute path for an image put in the folder itself', async () => {
        uploadToMachineSpy.mockImplementation(uploadsTo('.piggercode/uploads/messages/m1/'));
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });

        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));

        const call = uploadToMachineSpy.mock.calls[0]![0] as UploadCall;
        expect(handleCreateSession).toHaveBeenCalledWith({
            inputTextOverride: `/home/me/project/.piggercode/uploads/messages/m1/${call.request.fileName}`,
        });
    });

    it('sends what the composer shows when its images change during an upload', async () => {
        const upload = heldUpload();
        uploadToMachineSpy.mockImplementation(uploadsTo('/home/me/Downloads/'));
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot(), photo()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(upload.started()).toBe(true));

        // While the screenshot uploads: the photo is taken out and another screenshot pasted.
        await act(async () => {
            hook.getCurrent().attachments[1]!.onRemove!();
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        await act(async () => {
            upload.finish();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));

        const names = uploadToMachineSpy.mock.calls.map(([call]) => (call as UploadCall).request.fileName);
        expect(names).toHaveLength(2);
        expect(names.every((name) => name.endsWith('.png'))).toBe(true);
        expect(handleCreateSession).toHaveBeenCalledWith({
            inputTextOverride: names.map((name) => `/home/me/Downloads/${name}`).join('\n'),
        });
    });

    it('starts nothing once the screen is leaving while its images upload, and starts on the next send', async () => {
        const upload = heldUpload();
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(upload.started()).toBe(true));

        hook.getCurrent().cancelPendingSend();
        await act(async () => {
            upload.finish();
        });
        expect(handleCreateSession).not.toHaveBeenCalled();

        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));
        expect(uploadToMachineSpy).toHaveBeenCalledTimes(1);
    });

    it('goes on with the other images when one taken out meanwhile fails', async () => {
        let failFirst: (() => void) | null = null;
        uploadToMachineSpy.mockImplementationOnce(() => new Promise((resolve) => {
            failFirst = () => resolve({ success: false, error: 'connection reset' });
        }));
        uploadToMachineSpy.mockImplementation(uploadsTo('/home/me/Downloads/'));
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot(), photo()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(failFirst).not.toBeNull());

        await act(async () => {
            hook.getCurrent().attachments[0]!.onRemove!();
        });
        await act(async () => {
            failFirst!();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));

        const photoName = (uploadToMachineSpy.mock.calls[1]![0] as UploadCall).request.fileName;
        expect(photoName).toMatch(/\.jpg$/);
        expect(handleCreateSession).toHaveBeenCalledWith({ inputTextOverride: `/home/me/Downloads/${photoName}` });
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('starts nothing when the screen closes while its images upload', async () => {
        const upload = heldUpload();
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(upload.started()).toBe(true));

        await hook.unmount();
        await act(async () => {
            upload.finish();
        });

        expect(handleCreateSession).not.toHaveBeenCalled();
    });

    it('starts nothing when the computer changes while its images upload, and puts them on the new one next time', async () => {
        const upload = heldUpload();
        const { hook, handleCreateSession } = await renderNewSessionSend('');
        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(upload.started()).toBe(true));

        await hook.rerender({ target: otherComputer });
        await act(async () => {
            upload.finish();
        });
        expect(handleCreateSession).not.toHaveBeenCalled();

        uploadToMachineSpy.mockImplementation(uploadsTo('/home/me/Downloads/'));
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(handleCreateSession).toHaveBeenCalledTimes(1));
        expect((uploadToMachineSpy.mock.calls[1]![0] as UploadCall).machine).toEqual(otherComputer);
    });

    it('starts no session when an image cannot be put on the computer, keeps the image and says why', async () => {
        uploadToMachineSpy.mockResolvedValue({ success: false, error: 'File exceeds maximum allowed size' });
        const { hook, handleCreateSession } = await renderNewSessionSend('');

        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([screenshot()]);
        });
        await act(async () => {
            hook.getCurrent().onSend();
        });
        await vi.waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.any(String), 'File exceeds maximum allowed size'));

        expect(handleCreateSession).not.toHaveBeenCalled();
        expect(hook.getCurrent().attachments).toEqual([
            expect.objectContaining({ status: 'error', error: 'File exceeds maximum allowed size' }),
        ]);
    });

    it('takes images only, and says so about the other files', async () => {
        const { hook } = await renderNewSessionSend('');

        await act(async () => {
            hook.getCurrent().onAttachmentsAdded([new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' })]);
        });

        expect(hook.getCurrent().attachments).toEqual([]);
        expect(alertSpy).toHaveBeenCalledTimes(1);
    });
});

describe('resolveNewSessionSendTarget', () => {
    it('resolves a folder given from the home of its computer', async () => {
        const { resolveNewSessionSendTarget } = await import('./useNewSessionSend');

        expect(resolveNewSessionSendTarget({ machineId: 'machine-1', serverId: null, path: '~/project', homeDir: '/home/me' }))
            .toEqual({ machineId: 'machine-1', serverId: null, directory: '/home/me/project' });
    });
});

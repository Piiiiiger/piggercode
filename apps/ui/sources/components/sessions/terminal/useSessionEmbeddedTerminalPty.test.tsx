import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uploadToMachineSpy = vi.hoisted(() => vi.fn());
const alertSpy = vi.hoisted(() => vi.fn());

// The machine end of an upload: the chunked transfer to the session's machine.
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/transfers/runtime/bulkTransferPipeline')>()),
    uploadDaemonSessionAttachmentFromReader: (...args: unknown[]) => uploadToMachineSpy(...args),
}));

// The terminal's own machine calls (no machine is known here, so none are made).
vi.mock('@/sync/ops/machineTerminal', () => ({
    machineTerminalEnsure: vi.fn(),
    machineTerminalRestart: vi.fn(),
    machineTerminalStreamRead: vi.fn(),
    machineTerminalClose: vi.fn(),
    machineTerminalInput: vi.fn(),
    machineTerminalResize: vi.fn(),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: (...args: unknown[]) => alertSpy(...args) },
}));

// Settings left unset: the attachment defaults apply.
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({});
});

type UploadCall = Readonly<{ sessionId: string; request: Readonly<{ fileName: string; uploadLocation: string; sharedFolderPath?: string }> }>;

type TerminalChoice = Readonly<{ terminalKey: string; terminalMode: 'session_attach' | 'workspace_shell' }>;
const agentTerminal: TerminalChoice = { terminalKey: 'session-attach:session-1', terminalMode: 'session_attach' };
const shellTerminal: TerminalChoice = { terminalKey: 'session:session-1:terminal', terminalMode: 'workspace_shell' };
const noRenderer = { current: null };

async function renderSessionTerminal() {
    const { useSessionEmbeddedTerminalPty } = await import('./useSessionEmbeddedTerminalPty');
    return await renderHook((choice: TerminalChoice) => useSessionEmbeddedTerminalPty({
        sessionId: 'session-1',
        terminalKey: choice.terminalKey,
        terminalMode: choice.terminalMode,
        terminalRef: noRenderer,
    }), { initialProps: agentTerminal });
}

function screenshot(): File {
    return new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'image.png', { type: 'image/png' });
}

describe('useSessionEmbeddedTerminalPty pasted images', () => {
    beforeEach(() => {
        uploadToMachineSpy.mockReset();
        alertSpy.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('puts a pasted image where attachments go on the session machine, under a name of its own, and answers its path', async () => {
        uploadToMachineSpy.mockImplementation(async (call: UploadCall) => ({
            success: true,
            path: `/home/me/Downloads/${call.request.fileName}`,
            sizeBytes: 8,
            sha256: 'digest',
        }));
        const hook = await renderSessionTerminal();

        const paths = await hook.getCurrent().onPasteImages([screenshot()]);

        const call = uploadToMachineSpy.mock.calls[0]![0] as UploadCall;
        expect(call.sessionId).toBe('session-1');
        expect(call.request).toMatchObject({ uploadLocation: 'shared_folder', sharedFolderPath: '~/Downloads' });
        expect(call.request.fileName).toMatch(/^pasted-\d{8}-\d{6}-\d+-1\.png$/);
        expect(paths).toEqual([`/home/me/Downloads/${call.request.fileName}`]);
    });

    it('types nothing when the pane has switched to the session\'s other terminal before the upload finished', async () => {
        let finishUpload: (() => void) | null = null;
        uploadToMachineSpy.mockImplementation((call: UploadCall) => new Promise((resolve) => {
            finishUpload = () => resolve({ success: true, path: `/home/me/Downloads/${call.request.fileName}`, sizeBytes: 8, sha256: 'digest' });
        }));
        const hook = await renderSessionTerminal();

        const pasted = hook.getCurrent().onPasteImages([screenshot()]);
        await vi.waitFor(() => expect(finishUpload).not.toBeNull());
        await hook.rerender(shellTerminal);
        finishUpload!();

        await expect(pasted).resolves.toEqual([]);
    });

    it('says why when an image cannot be put on the machine, and types nothing', async () => {
        uploadToMachineSpy.mockResolvedValue({ success: false, error: 'File exceeds maximum allowed size' });
        const hook = await renderSessionTerminal();

        const paths = await hook.getCurrent().onPasteImages([screenshot(), screenshot()]);

        expect(paths).toEqual([]);
        expect(uploadToMachineSpy).toHaveBeenCalledTimes(1);
        expect(alertSpy).toHaveBeenCalledWith(expect.any(String), 'File exceeds maximum allowed size');
    });
});

import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deferredLaunches = vi.hoisted((): Array<() => void> => []);

// The web frame scheduler: the launch runs on the next frame, held here until the test runs it.
vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (action: () => void) => {
        deferredLaunches.push(action);
    },
    blurActiveElementOnWeb: () => {},
}));

// The machine end of an upload: the chunked transfer to the computer the session will run on.
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/transfers/runtime/bulkTransferPipeline')>()),
    uploadDaemonSessionAttachmentFromReader: async (call: { request: { fileName: string } }) => ({
        success: true,
        path: `/home/me/Downloads/${call.request.fileName}`,
        sizeBytes: 8,
        sha256: 'digest',
    }),
}));

vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({});
});

async function sendOneImage() {
    const { useNewSessionSend } = await import('./useNewSessionSend');
    const { createNewSessionPromptStore } = await import('./screenModel/newSessionPromptStore');
    const handleCreateSession = vi.fn();
    const promptStore = createNewSessionPromptStore('');
    const target = { machineId: 'machine-1', serverId: null, directory: '/home/me/project' };
    const hook = await renderHook(() => useNewSessionSend({ promptStore, handleCreateSession, getSendTarget: () => target }));
    await act(async () => {
        hook.getCurrent().onAttachmentsAdded([new File([new Uint8Array([137, 80])], 'image.png', { type: 'image/png' })]);
    });
    await act(async () => {
        hook.getCurrent().onSend();
    });
    await vi.waitFor(() => expect(deferredLaunches).toHaveLength(1));
    return { hook, handleCreateSession };
}

describe('useNewSessionSend launch after its images uploaded', () => {
    afterEach(() => {
        deferredLaunches.length = 0;
        standardCleanup();
    });

    it('starts the session on the next frame', async () => {
        const { handleCreateSession } = await sendOneImage();

        deferredLaunches.shift()!();

        expect(handleCreateSession).toHaveBeenCalledTimes(1);
    });

    it('starts nothing when the screen starts leaving in the frame before the launch', async () => {
        const { hook, handleCreateSession } = await sendOneImage();

        hook.getCurrent().cancelPendingSend();
        deferredLaunches.shift()!();

        expect(handleCreateSession).not.toHaveBeenCalled();
    });
});

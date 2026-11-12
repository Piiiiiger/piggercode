import type { FeaturesResponse } from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const machineRpcMock = vi.hoisted(() => vi.fn());
const getReadyServerFeaturesMock = vi.hoisted(() => vi.fn());

// The transport to the machine: a machine RPC through the session's server.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (params: unknown) => machineRpcMock(params),
}));
vi.mock('@/sync/api/session/apiSocket', () => ({
    apiSocket: { machineRPC: vi.fn(), sessionRPC: vi.fn() },
}));
// The server's feature snapshot, which carries its transfer policy.
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: (params: unknown) => getReadyServerFeaturesMock(params),
}));

function serverFeatures(transferEnabled: boolean): FeaturesResponse {
    return {
        features: { machines: { enabled: true, transfer: { enabled: transferEnabled, serverRouted: { enabled: true } } } },
        capabilities: {},
    } as FeaturesResponse;
}

async function uploadInitThroughMachineCaller() {
    const { createMachineFileTransferRpcCaller } = await import('./sessionFileTransferRpcCaller');
    const { rebaseWorkspaceRootRequestToMachineTarget } = await import('@/sync/runtime/sessionMachineRpcFallback');
    const caller = createMachineFileTransferRpcCaller({
        machineId: 'machine-1',
        serverId: 'server-1',
        directory: '/home/me/project',
        transferSizeBytes: 8,
    });
    return await caller.call({
        request: { t: 'session_attachment_upload_v1', fileName: 'shot.png', uploadLocation: 'workspace' },
        machineMethod: RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT,
        sessionMethod: RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT,
        toMachineRequest: rebaseWorkspaceRootRequestToMachineTarget,
    });
}

describe('createMachineFileTransferRpcCaller', () => {
    beforeEach(() => {
        machineRpcMock.mockReset();
        getReadyServerFeaturesMock.mockReset();
    });

    it('sends a workspace upload to the machine, with the folder the session will start in as its workspace', async () => {
        getReadyServerFeaturesMock.mockResolvedValue(serverFeatures(true));
        machineRpcMock.mockResolvedValue({ success: true, uploadId: 'upload-1', chunkSizeBytes: 1024, recipientPublicKeyBase64: 'key' });

        const response = await uploadInitThroughMachineCaller();

        expect(getReadyServerFeaturesMock).toHaveBeenCalledWith({ serverId: 'server-1' });
        expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-1',
            method: RPC_METHODS.DAEMON_BULK_TRANSFER_UPLOAD_INIT,
            payload: expect.objectContaining({ fileName: 'shot.png', workspaceRootPath: '/home/me/project' }),
        }));
        expect(response).toMatchObject({ success: true, uploadId: 'upload-1' });
    });

    it('does not reach the machine when the server\'s transfer policy turns machine transfer off', async () => {
        getReadyServerFeaturesMock.mockResolvedValue(serverFeatures(false));

        const response = await uploadInitThroughMachineCaller();

        expect(response).toMatchObject({ success: false });
        expect(machineRpcMock).not.toHaveBeenCalled();
    });
});

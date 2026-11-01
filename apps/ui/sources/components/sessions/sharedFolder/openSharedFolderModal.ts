import { resolveSharedFolderPathSetting } from '@/components/sessions/attachments/useAttachmentsUploadConfig';
import { Modal } from '@/modal';
import { storage } from '@/sync/domains/state/storage';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { t } from '@/text';

import { SharedFolderModalEntry } from './SharedFolderModalEntry';
import { resolveSharedFolderLocation } from './sharedFolderLocation';

/** Opens the shared folder of the machine that runs this session. */
export function openSharedFolderModal(params: Readonly<{ sessionId: string }>): void {
    const state = storage.getState();
    const machineTarget = readMachineControlTargetForSession(params.sessionId);
    const homeDir = machineTarget
        ? (state.machines[machineTarget.machineId]?.metadata?.homeDir ?? state.sessions[params.sessionId]?.metadata?.homeDir)
        : null;
    const location = resolveSharedFolderLocation({
        sharedFolderPath: resolveSharedFolderPathSetting(state.settings.attachmentsUploadsSharedFolderPath),
        homeDir,
    });
    if (!machineTarget || !location) {
        Modal.alert(t('files.sharedFolder.unavailableTitle'), t('files.sharedFolder.unavailableMessage'));
        return;
    }

    Modal.show({
        chrome: { kind: 'card', dimensions: { maxHeightRatio: 0.92 } },
        component: SharedFolderModalEntry,
        props: {
            sessionId: params.sessionId,
            machineId: machineTarget.machineId,
            serverId: resolvePreferredServerIdForSessionId(params.sessionId) ?? null,
            location,
        },
        closeOnBackdrop: true,
    });
}

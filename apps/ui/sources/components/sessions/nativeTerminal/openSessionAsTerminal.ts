import { stopSessionAndWaitUntilEnded } from '@/components/sessions/sessionStopArchiveFlow';
import { Modal } from '@/modal';
import { storage } from '@/sync/domains/state/storage';
import { readMachineControlTargetForSession } from '@/sync/ops/sessionMachineTarget';
import { resumeSession, sessionStopWithServerScope } from '@/sync/ops/sessions';
import { t } from '@/text';

import { buildTerminalReopenOptions } from './nativeTerminalSessions';

/** Opens a stopped session as its CLI in a terminal, continuing the conversation it has. */
export async function reopenSessionAsTerminal(params: Readonly<{
    sessionId: string;
    serverId: string | null;
}>): Promise<boolean> {
    const session = storage.getState().sessions[params.sessionId];
    const target = readMachineControlTargetForSession(params.sessionId);
    if (!session || !target) {
        Modal.alert(t('common.error'), t('session.machineOfflineCannotResume'));
        return false;
    }
    const options = buildTerminalReopenOptions({
        sessionId: params.sessionId,
        session,
        machineId: target.machineId,
        directory: target.basePath,
        serverId: params.serverId,
    });
    if (!options) {
        Modal.alert(t('common.error'), t('session.resumeFailed'));
        return false;
    }
    const result = await resumeSession(options);
    if (result.type === 'error') {
        Modal.alert(t('common.error'), result.errorMessage || t('session.resumeFailed'));
        return false;
    }
    return true;
}

/**
 * Moves a running chat into the terminal: stops its runner, waits until it is gone (two runners must
 * never write one conversation), then reopens the session as a terminal on the same conversation.
 */
export async function switchChatSessionToTerminal(params: Readonly<{
    sessionId: string;
    serverId: string | null;
}>): Promise<boolean> {
    const problem = await stopSessionAndWaitUntilEnded({
        sessionId: params.sessionId,
        stopSession: () => sessionStopWithServerScope(params.sessionId, { serverId: params.serverId }),
        stopErrorMessage: t('sessionNativeTerminal.switchFailed'),
    });
    if (problem) {
        Modal.alert(t('common.error'), problem);
        return false;
    }
    return reopenSessionAsTerminal(params);
}

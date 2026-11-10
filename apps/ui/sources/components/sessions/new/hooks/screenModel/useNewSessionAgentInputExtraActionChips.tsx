import * as React from 'react';
import type { WindowsRemoteSessionLaunchMode } from '@piggercode/protocol';

import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { createServerActionChip } from '@/components/sessions/agentInput/definitions/createServerActionChip';
import { createWindowsRemoteSessionLaunchModeActionChip } from '@/components/sessions/agentInput/definitions/createWindowsRemoteSessionLaunchModeActionChip';
import { NewSessionServerSelectionContent } from '@/components/sessions/new/components/NewSessionServerSelectionContent';

/**
 * The chips beside the new-session composer. Every session starts as the CLI's own terminal, so only
 * the choices the CLI does not make itself remain: where it runs (checkout, server) and, on Windows,
 * how its window is hosted.
 */
export function useNewSessionAgentInputExtraActionChips(params: Readonly<{
    checkoutActionChip?: AgentInputExtraActionChip | null;
    showServerPickerChip: boolean;
    targetServerId: string | null;
    targetServerName: string;
    selectedMachineIsWindows: boolean;
    windowsRemoteSessionLaunchMode: WindowsRemoteSessionLaunchMode | null;
    windowsTerminalAvailable: boolean;
    onWindowsRemoteSessionLaunchModeChange: (next: WindowsRemoteSessionLaunchMode) => void;
}>): ReadonlyArray<AgentInputExtraActionChip> {
    const serverPickerActionChip = React.useMemo<AgentInputExtraActionChip | null>(() => {
        if (!params.showServerPickerChip) return null;
        return createServerActionChip({
            label: params.targetServerName,
            popoverContent: ({ requestClose, maxHeight }) => (
                <NewSessionServerSelectionContent
                    maxHeight={Math.min(760, maxHeight)}
                    onClose={requestClose}
                    dismissOnSelection={true}
                    selectedServerId={params.targetServerId}
                />
            ),
            maxHeightCap: 760,
            maxWidthCap: 620,
        });
    }, [params.showServerPickerChip, params.targetServerId, params.targetServerName]);

    return React.useMemo(() => {
        const chips: AgentInputExtraActionChip[] = [];
        if (params.checkoutActionChip) {
            chips.push(params.checkoutActionChip);
        }
        if (serverPickerActionChip) {
            chips.push(serverPickerActionChip);
        }
        if (params.selectedMachineIsWindows && params.windowsRemoteSessionLaunchMode) {
            chips.push(createWindowsRemoteSessionLaunchModeActionChip({
                mode: params.windowsRemoteSessionLaunchMode,
                windowsTerminalAvailable: params.windowsTerminalAvailable,
                onModeChange: params.onWindowsRemoteSessionLaunchModeChange,
            }));
        }
        return chips;
    }, [
        params.checkoutActionChip,
        params.selectedMachineIsWindows,
        params.windowsRemoteSessionLaunchMode,
        params.windowsTerminalAvailable,
        params.onWindowsRemoteSessionLaunchModeChange,
        serverPickerActionChip,
    ]);
}

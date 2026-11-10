import * as React from 'react';

import { describe, expect, it, vi } from 'vitest';

import type { AgentInputExtraActionChip } from '@/components/sessions/agentInput/agentInputContracts';
import { renderScreen } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

import { installNewSessionScreenModelCommonModuleMocks } from '../newSessionScreenModelTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installNewSessionScreenModelCommonModuleMocks({
    storage: async () => createStorageModuleStub({
        storage: {
            getState: () => ({}),
        },
    }),
});

describe('useNewSessionAgentInputExtraActionChips', () => {
    it('passes the available server popover height through without imposing a minimum', async () => {
        const { useNewSessionAgentInputExtraActionChips } = await import('./useNewSessionAgentInputExtraActionChips');

        let chips: ReadonlyArray<AgentInputExtraActionChip> = [];

        function Probe() {
            chips = useNewSessionAgentInputExtraActionChips({
                showServerPickerChip: true,
                targetServerId: 'server-a',
                targetServerName: 'Server A',
                selectedMachineIsWindows: false,
                windowsRemoteSessionLaunchMode: null,
                windowsTerminalAvailable: false,
                onWindowsRemoteSessionLaunchModeChange: vi.fn(),
            });
            return null;
        }

        await renderScreen(<Probe />);

        const serverChip = chips.find((chip) => chip.key === 'new-session-target-server');
        const renderContent = serverChip?.collapsedContentPopover?.renderContent;
        expect(typeof renderContent).toBe('function');
        const renderedContent = typeof renderContent === 'function'
            ? renderContent({ requestClose: vi.fn(), maxHeight: 300 })
            : null;

        expect(React.isValidElement(renderedContent)).toBe(true);
        expect((renderedContent as React.ReactElement<{ maxHeight: number }>).props.maxHeight).toBe(300);
    });
});

import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES, RPC_METHODS } from '@piggercode/protocol/rpc';
import { createRpcCallError } from '@piggercode/protocol/rpcErrors';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

const machineRpcMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const alertMock = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).installTextModuleMock()());

vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).installModalModuleMock({
    spies: {
        confirm: (...args) => confirmMock(...args),
        alert: (...args) => alertMock(...args),
    },
})());

vi.mock('@/components/ui/lists/ItemGroup', async () => {
    const { createPassThroughModule } = await import('@/dev/testkit/mocks/components');
    return createPassThroughModule(['ItemGroup']);
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props, props.rightElement as React.ReactNode),
}));

vi.mock('@/components/ui/forms/Switch', async () => {
    const { createPassThroughModule } = await import('@/dev/testkit/mocks/components');
    return createPassThroughModule(['Switch']);
});

// The relay/socket transport is the boundary; the app's machine operations stay real.
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => {
    const { installServerScopedMachineRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
    return installServerScopedMachineRpcModuleMock({
        machineRpcWithServerScope: (params: unknown) => machineRpcMock(params) as never,
    })(importOriginal);
});

type MachineRpcCall = Readonly<{ machineId: string; method: string; payload: Readonly<{ enabled?: unknown }> }>;

/** The machine end of the two settings calls, answering the way the daemon's handlers do. */
function connectMachine(initial: Readonly<{ enabled: boolean; failWrites?: string }>) {
    const machine = { enabled: initial.enabled };
    machineRpcMock.mockImplementation(async (call: MachineRpcCall) => {
        expect(call.machineId).toBe('machine-1');
        if (call.method === RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_GET) {
            return { remoteCommandsEnabled: machine.enabled };
        }
        if (call.method === RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_SET) {
            // A handler that throws reaches the app as an `{ error }` result.
            if (initial.failWrites) return { error: initial.failWrites };
            machine.enabled = call.payload.enabled === true;
            return { remoteCommandsEnabled: machine.enabled };
        }
        throw new Error(`unexpected machine call ${call.method}`);
    });
    return machine;
}

async function renderGroup(isOnline = true) {
    const { MachineRemoteCommandsGroup } = await import('./MachineRemoteCommandsGroup');
    const screen = await renderScreen(
        <MachineRemoteCommandsGroup machineId="machine-1" machineName="laptop" isOnline={isOnline} serverId="server-a" />,
    );
    await flushHookEffects({ cycles: 8 });
    return {
        row: () => screen.findByTestId('machine-remote-commands'),
        toggle: () => screen.findByTestId('machine-remote-commands-switch'),
        flip: async (next: boolean) => {
            act(() => {
                screen.findByTestId('machine-remote-commands-switch')?.props.onValueChange(next);
            });
            await flushHookEffects({ cycles: 8 });
        },
    };
}

describe('MachineRemoteCommandsGroup', () => {
    afterEach(() => {
        standardCleanup();
        machineRpcMock.mockReset();
        confirmMock.mockReset();
        alertMock.mockReset();
    });

    it('turns remote commands on only after the user confirms, and off without asking', async () => {
        const machine = connectMachine({ enabled: false });
        confirmMock.mockResolvedValue(true);
        const group = await renderGroup();

        expect(group.toggle()?.props.value).toBe(false);
        expect(group.toggle()?.props.disabled).toBe(false);
        expect(group.row()?.props.subtitle).toBe('machine.remoteCommands.offSubtitle');

        await group.flip(true);
        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(machine.enabled).toBe(true);
        expect(group.toggle()?.props.value).toBe(true);
        expect(group.row()?.props.subtitle).toBe('machine.remoteCommands.onSubtitle');

        await group.flip(false);
        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(machine.enabled).toBe(false);
        expect(group.toggle()?.props.value).toBe(false);
    });

    it('leaves the machine untouched when the user declines', async () => {
        const machine = connectMachine({ enabled: false });
        confirmMock.mockResolvedValue(false);
        const group = await renderGroup();

        await group.flip(true);

        expect(confirmMock).toHaveBeenCalledTimes(1);
        expect(machine.enabled).toBe(false);
        expect(group.toggle()?.props.value).toBe(false);
        expect(machineRpcMock.mock.calls.map(([call]) => (call as MachineRpcCall).method))
            .not.toContain(RPC_METHODS.DAEMON_MACHINE_COMMAND_SETTINGS_SET);
    });

    it('keeps the switch where it was and says why when the machine cannot save it', async () => {
        const machine = connectMachine({ enabled: true, failWrites: 'settings file is locked' });
        const group = await renderGroup();

        await group.flip(false);

        expect(machine.enabled).toBe(true);
        expect(group.toggle()?.props.value).toBe(true);
        expect(alertMock).toHaveBeenCalledWith('common.error', {
            key: 'machine.remoteCommands.saveFailed',
            params: { message: 'settings file is locked' },
        });
    });

    it('does not call an offline machine and keeps the switch disabled', async () => {
        connectMachine({ enabled: true });
        const group = await renderGroup(false);

        expect(machineRpcMock).not.toHaveBeenCalled();
        expect(group.toggle()?.props.disabled).toBe(true);
        expect(group.row()?.props.subtitle).toBe('machine.remoteCommands.offline');
    });

    it('disables the switch when the machine cannot take the call', async () => {
        machineRpcMock.mockRejectedValue(createRpcCallError({
            error: 'RPC method not available',
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        }));
        const group = await renderGroup();

        expect(group.toggle()?.props.disabled).toBe(true);
        expect(group.row()?.props.subtitle).toBe('machine.remoteCommands.unavailable');
    });
});

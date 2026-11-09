import { describe, expect, it } from 'vitest';

import { installToolShellPresentationCommonModuleMocks } from '../../shell/presentation/toolShellPresentationTestHelpers';

installToolShellPresentationCommonModuleMocks();

describe('parseMachineCommandResult', () => {
    const reply = { success: true, stdout: '34G\t.\n', stderr: '', exitCode: 0 };

    it('reads the machine reply from a Codex MCP result', async () => {
        const { parseMachineCommandResult } = await import('./MachineCommandView');
        expect(parseMachineCommandResult({ content: [{ type: 'text', text: JSON.stringify(reply) }], isError: false }))
            .toMatchObject({ success: true, stdout: '34G\t.\n', exitCode: 0 });
    });

    it('reads the machine reply from a Claude tool result', async () => {
        const { parseMachineCommandResult } = await import('./MachineCommandView');
        expect(parseMachineCommandResult([{ type: 'text', text: JSON.stringify(reply) }]))
            .toMatchObject({ stdout: '34G\t.\n' });
        expect(parseMachineCommandResult(JSON.stringify(reply))).toMatchObject({ stdout: '34G\t.\n' });
    });

    it('keeps the reason a machine refused to run the command', async () => {
        const { parseMachineCommandResult } = await import('./MachineCommandView');
        const refused = { success: false, errorCode: 'remote_commands_disabled', error: 'Remote commands are off on this machine' };
        expect(parseMachineCommandResult({ content: [{ type: 'text', text: JSON.stringify(refused) }], isError: true }))
            .toMatchObject({ success: false, errorCode: 'remote_commands_disabled', error: 'Remote commands are off on this machine' });
    });

    it('returns null for output that is not a machine reply', async () => {
        const { parseMachineCommandResult } = await import('./MachineCommandView');
        expect(parseMachineCommandResult({ content: [{ type: 'text', text: 'tool_failed' }] })).toBeNull();
    });
});

describe('getToolViewComponent', () => {
    it('gives PiggerCode remote commands their own view', async () => {
        const { getToolViewComponent } = await import('../core/_registry');
        const { MachineCommandView } = await import('./MachineCommandView');
        expect(getToolViewComponent('mcp__piggercode__machine_command_run')).toBe(MachineCommandView);
        expect(getToolViewComponent('mcp__linear__create_issue')).not.toBe(MachineCommandView);
    });
});

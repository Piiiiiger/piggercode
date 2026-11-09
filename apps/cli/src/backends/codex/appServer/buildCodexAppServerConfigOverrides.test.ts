import { describe, expect, it } from 'vitest';

import { buildCodexAppServerConfigOverrides } from './buildCodexAppServerConfigOverrides';

describe('buildCodexAppServerConfigOverrides', () => {
    it('preserves ordered opaque native config overrides and ignores prompt text after the argument terminator', () => {
        expect(buildCodexAppServerConfigOverrides({}, {
            codexArgs: ['-c', 'model_reasoning_effort=low', '--config', 'custom.value="a=b"', '--config=model_reasoning_effort=high', '-cmodel_reasoning_effort=low', '-c=personality="friendly"', '--', '-c', 'model_reasoning_effort=medium'],
        })).toEqual(['model_reasoning_effort=low', 'custom.value="a=b"', 'model_reasoning_effort=high', 'model_reasoning_effort=low', 'personality="friendly"']);
        expect(() => buildCodexAppServerConfigOverrides({}, { codexArgs: ['-c'] })).toThrow();
    });
    it('translates materialized PiggerCode MCP servers into additive app-server config overrides', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            piggercode: {
                command: '/tmp/happier-mcp-bridge',
                args: ['--url', 'http://127.0.0.1:0'],
                env: {
                    PIGGERCODE_MCP_REMOTE_BRIDGE_CONFIG_FILE: '/tmp/bridge-config.json',
                },
            },
        });

        expect(overrides).toEqual([
            'mcp_optional_startup_grace_ms=60000',
            'mcp_servers.piggercode.command="/tmp/happier-mcp-bridge"',
            'mcp_servers.piggercode.args=["--url","http://127.0.0.1:0"]',
            'mcp_servers.piggercode.env={PIGGERCODE_MCP_REMOTE_BRIDGE_CONFIG_FILE="/tmp/bridge-config.json"}',
            'mcp_servers.piggercode.enabled=true',
            'mcp_servers.piggercode.startup_timeout_sec=60',
            'mcp_servers.piggercode.tool_timeout_sec=3720',
            'mcp_servers.piggercode.tools.execution_run_get.approval_mode="approve"',
            'mcp_servers.piggercode.tools.execution_run_list.approval_mode="approve"',
            'mcp_servers.piggercode.tools.execution_run_wait.approval_mode="approve"',
        ]);
    });

    it('uses the app-server startup budget for optional PiggerCode MCP discovery without making it required', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            piggercode: { command: 'piggercode-mcp' },
        }, {
            processEnv: {
                PIGGERCODE_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '90000',
            },
        });

        expect(overrides).toContain('mcp_optional_startup_grace_ms=90000');
        expect(overrides).toContain('mcp_servers.piggercode.startup_timeout_sec=90');
        expect(overrides.some((override) => override.includes('.required='))).toBe(false);
    });

    it('prefixes configured server names so user Codex MCP entries cannot collide with PiggerCode-injected ones', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            context7: {
                command: 'echo',
                args: ['hello'],
            },
            'server.with spaces': {
                command: 'node',
            },
        });

        expect(overrides).toContain('mcp_servers.piggercode__context7.command="echo"');
        expect(overrides).toContain('mcp_servers.piggercode__server_with_spaces.command="node"');
        expect(overrides).not.toContain('mcp_servers.context7.command="echo"');
        expect(overrides.some((override) => override.includes('.tool_timeout_sec='))).toBe(false);
        expect(overrides.some((override) => override.includes('.tools.execution_run_wait.approval_mode'))).toBe(false);
    });

    it('uses the configured bounded PiggerCode MCP tool-call timeout', () => {
        const overrides = buildCodexAppServerConfigOverrides({
            piggercode: { command: 'piggercode-mcp' },
        }, {
            happierMcpToolCallTimeoutMs: 7_230_500,
        });

        expect(overrides).toContain('mcp_servers.piggercode.tool_timeout_sec=7230.5');
    });

    it('injects only the explicit PiggerCode session context into Codex shell subprocesses', () => {
        const overrides = buildCodexAppServerConfigOverrides({}, {
            happierSessionId: 'session-123',
        });

        expect(overrides).toEqual([
            'shell_environment_policy.set.PIGGERCODE_SESSION_ID="session-123"',
        ]);
    });

    it('does not inject unresolved offline session context', () => {
        expect(buildCodexAppServerConfigOverrides({}, {
            happierSessionId: 'offline-session-123',
        })).toEqual([]);
    });

    it('applies the subagent limit before explicit Codex arguments', () => {
        expect(buildCodexAppServerConfigOverrides({}, { subagentLimit: null })).toEqual([]);
        expect(buildCodexAppServerConfigOverrides({}, { subagentLimit: 0 })).toEqual([
            'features.multi_agent=false',
            'features.multi_agent_v2=false',
        ]);
        expect(buildCodexAppServerConfigOverrides({}, {
            subagentLimit: 2,
            codexArgs: ['-c', 'agents.max_concurrent_threads_per_session=4'],
        })).toEqual([
            'agents.max_concurrent_threads_per_session=2',
            'agents.max_concurrent_threads_per_session=4',
        ]);
    });
});

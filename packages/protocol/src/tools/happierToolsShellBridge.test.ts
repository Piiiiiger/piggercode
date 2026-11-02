import { describe, expect, it } from 'vitest';

import { parseHappierToolsShellBridgeCommand } from './happierToolsShellBridge.js';

describe('parseHappierToolsShellBridgeCommand', () => {
  it('parses piggercode tools list invocations', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        'piggercode tools list --session-id "sess-1" --directory "/tmp/workspace" --json',
      ),
    ).toEqual({
      kind: 'list',
      rawCommand: 'piggercode tools list --session-id "sess-1" --directory "/tmp/workspace" --json',
      sessionId: 'sess-1',
      directory: '/tmp/workspace',
      json: true,
    });
  });

  it('still parses tools invocations recorded with the upstream happier command', () => {
    expect(
      parseHappierToolsShellBridgeCommand('happier tools list --session-id "sess-1" --directory "/tmp/workspace" --json'),
    ).toMatchObject({ kind: 'list', sessionId: 'sess-1', directory: '/tmp/workspace', json: true });
  });

  it('parses node-invoked piggercode tools list bridge commands', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        `'/Users/leeroy/.nvm/versions/node/v22.14.0/bin/node' '--no-warnings' '--no-deprecation' '/Users/leeroy/Documents/Development/happier/dev/apps/cli/dist/index.mjs' 'tools' 'list' '--session-id' 'sess-1' '--directory' '/tmp/workspace' '--json'`,
      ),
    ).toEqual({
      kind: 'list',
      rawCommand:
        `'/Users/leeroy/.nvm/versions/node/v22.14.0/bin/node' '--no-warnings' '--no-deprecation' '/Users/leeroy/Documents/Development/happier/dev/apps/cli/dist/index.mjs' 'tools' 'list' '--session-id' 'sess-1' '--directory' '/tmp/workspace' '--json'`,
      sessionId: 'sess-1',
      directory: '/tmp/workspace',
      json: true,
    });
  });

  it('parses piggercode tools call invocations with JSON args', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        `piggercode tools call --session-id "sess-1" --directory "/tmp/workspace" --source piggercode --tool change_title --args-json '{"title":"Renamed"}' --json`,
      ),
    ).toEqual({
      kind: 'call',
      rawCommand:
        `piggercode tools call --session-id "sess-1" --directory "/tmp/workspace" --source piggercode --tool change_title --args-json '{"title":"Renamed"}' --json`,
      sessionId: 'sess-1',
      directory: '/tmp/workspace',
      source: 'piggercode',
      tool: 'change_title',
      argsJson: '{"title":"Renamed"}',
      args: { title: 'Renamed' },
      json: true,
    });
  });

  it('rejects unset preludes', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; FOO=bar piggercode tools call --source playwright --tool open_page --args-json \'{"url":"https://example.com"}\'',
      ),
    ).toBeNull();
  });

  it('parses env preludes when quoted values contain spaces', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        'PIGGERCODE_SPAWN_HOOK=\'/Applications/Test Hook/hook.js\' NODE_OPTIONS=\'--require /Applications/Test Hook/register.js\' piggercode tools list --session-id "sess-1" --directory "/tmp/workspace" --json',
      ),
    ).toEqual({
      kind: 'list',
      rawCommand:
        'PIGGERCODE_SPAWN_HOOK=\'/Applications/Test Hook/hook.js\' NODE_OPTIONS=\'--require /Applications/Test Hook/register.js\' piggercode tools list --session-id "sess-1" --directory "/tmp/workspace" --json',
      sessionId: 'sess-1',
      directory: '/tmp/workspace',
      json: true,
    });
  });

  it('returns null for unrelated shell commands', () => {
    expect(parseHappierToolsShellBridgeCommand('git status --short')).toBeNull();
  });

  it.each([
    'piggercode tools call --source piggercode --tool save_memory --json; touch /tmp/happier-pwn',
    'piggercode tools call --source piggercode --tool save_memory --json && touch /tmp/happier-pwn',
    'piggercode tools call --source piggercode --tool save_memory --json || touch /tmp/happier-pwn',
    'piggercode tools call --source piggercode --tool save_memory --json | cat',
    'piggercode tools call --source piggercode --tool save_memory --json > /tmp/happier-pwn',
    'piggercode tools call --source piggercode --tool save_memory --json $(touch /tmp/happier-pwn)',
    'piggercode tools call --source piggercode --tool save_memory --json `touch /tmp/happier-pwn`',
    'piggercode tools call --source piggercode --tool save_memory --json\n touch /tmp/happier-pwn',
    'piggercode tools call --source piggercode --tool save_memory --json extra-token',
  ])('rejects shell bridge commands with trailing shell execution: %s', (command) => {
    expect(parseHappierToolsShellBridgeCommand(command)).toBeNull();
  });

  it.each([
    'piggercode tools list --json --json',
    'piggercode tools list --session-id one --session-id two',
    'piggercode tools call --source piggercode --source custom --tool think',
    'piggercode tools call --source piggercode --tool think --tool save_memory',
  ])('rejects duplicate flags: %s', (command) => {
    expect(parseHappierToolsShellBridgeCommand(command)).toBeNull();
  });

  it('rejects invalid JSON arguments', () => {
    expect(
      parseHappierToolsShellBridgeCommand(
        `piggercode tools call --source piggercode --tool save_memory --args-json '{'`,
      ),
    ).toBeNull();
  });
});

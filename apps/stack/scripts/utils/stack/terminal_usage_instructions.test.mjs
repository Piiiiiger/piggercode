import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTerminalUsageInstructions } from './terminal_usage_instructions.mjs';

test('renderTerminalUsageInstructions prints a runnable piggercode command and key env exports', () => {
  const lines = renderTerminalUsageInstructions({
    internalServerUrl: 'http://127.0.0.1:3014',
    cliHomeDir: '/tmp/happier/stack/cli',
    publicServerUrl: 'http://happier-pr.localhost:8084/?server=http%3A%2F%2Flocalhost%3A3014',
    activeServerId: 'stack_pr-123__id_default',
    stackName: 'pr-123',
  });

  const text = lines.join('\n');
  assert.match(text, /Terminal usage/);
  assert.match(text, /export PIGGERCODE_SERVER_URL="http:\/\/127\.0\.0\.1:3014"/);
  assert.match(text, /export PIGGERCODE_HOME_DIR="\/tmp\/happier\/stack\/cli"/);
  assert.match(text, /export PIGGERCODE_WEBAPP_URL="http:\/\/happier-pr\.localhost:8084/);
  assert.match(text, /export PIGGERCODE_ACTIVE_SERVER_ID="stack_pr-123__id_default"/);
  assert.match(text, /export PIGGERCODE_STACK_STACK="pr-123"/);
  assert.match(text, /\bhstack piggercode auth status --json\b/);
  assert.match(text, /\bThen run:\s*hstack happier\b/);
  assert.match(text, /PIGGERCODE_STACK_STACK="pr-123".*hstack happier/);
});

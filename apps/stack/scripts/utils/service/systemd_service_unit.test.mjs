import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSystemdServiceUnit } from './systemd_service_unit.mjs';

test('renderSystemdServiceUnit emits a minimal systemd unit with env + working dir', () => {
  const unit = renderSystemdServiceUnit({
    description: 'Happier Self-Host',
    execStart: '/home/me/.piggercode/self-host/bin/happier-server',
    workingDirectory: '/home/me/.piggercode/self-host',
    env: {
      PORT: '3005',
      PIGGERCODE_DB_PROVIDER: 'sqlite',
    },
    restart: 'on-failure',
    stdoutPath: '/home/me/.piggercode/self-host/logs/server.out.log',
    stderrPath: '/home/me/.piggercode/self-host/logs/server.err.log',
  });

  assert.match(unit, /^\[Unit\]/m);
  assert.match(unit, /Description=Happier Self-Host/);
  assert.match(unit, /WorkingDirectory=\/home\/me\/\.piggercode\/self-host/);
  assert.match(unit, /ExecStart=\/home\/me\/\.piggercode\/self-host\/bin\/happier-server/);
  assert.match(unit, /Environment=PORT=3005/);
  assert.match(unit, /Environment=PIGGERCODE_DB_PROVIDER=sqlite/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /StandardOutput=append:\/home\/me\/\.piggercode\/self-host\/logs\/server\.out\.log/);
  assert.match(unit, /StandardError=append:\/home\/me\/\.piggercode\/self-host\/logs\/server\.err\.log/);
});

test('renderSystemdServiceUnit supports system mode User= lines', () => {
  const unit = renderSystemdServiceUnit({
    description: 'Happier Stack',
    execStart: '/opt/happier/bin/hstack start',
    workingDirectory: '%h',
    env: { PIGGERCODE_STACK_ENV_FILE: '%h/.piggercode/stacks/main/env' },
    restart: 'always',
    runAsUser: 'happier',
  });

  assert.match(unit, /\nUser=happier\n/);
});

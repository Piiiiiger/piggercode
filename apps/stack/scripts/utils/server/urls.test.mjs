import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getPublicServerUrlEnvOverride } from './urls.mjs';

test('getPublicServerUrlEnvOverride prefers PIGGERCODE_PUBLIC_SERVER_URL over PIGGERCODE_STACK_SERVER_URL when both are stack-local', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const envPath = join(dir, 'stack.env');
  await writeFile(
    envPath,
    [
      'PIGGERCODE_PUBLIC_SERVER_URL=https://public.stack.example.test',
      'PIGGERCODE_STACK_SERVER_URL=http://127.0.0.1:3005',
    ].join('\n'),
    'utf-8'
  );

  const out = getPublicServerUrlEnvOverride({
    env: {
      PIGGERCODE_STACK_STACK: 'dev-built',
      PIGGERCODE_STACK_ENV_FILE: envPath,
      PIGGERCODE_PUBLIC_SERVER_URL: 'https://public.stack.example.test',
      PIGGERCODE_STACK_SERVER_URL: 'http://127.0.0.1:3005',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://public.stack.example.test');
  assert.equal(out.publicServerUrl, 'https://public.stack.example.test');
});

test('getPublicServerUrlEnvOverride falls back to PIGGERCODE_STACK_SERVER_URL when no public URL is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const envPath = join(dir, 'stack.env');
  await writeFile(envPath, 'PIGGERCODE_STACK_SERVER_URL=https://stack-share.example.test\n', 'utf-8');

  const out = getPublicServerUrlEnvOverride({
    env: {
      PIGGERCODE_STACK_STACK: 'dev-built',
      PIGGERCODE_STACK_ENV_FILE: envPath,
      PIGGERCODE_STACK_SERVER_URL: 'https://stack-share.example.test',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://stack-share.example.test');
  assert.equal(out.publicServerUrl, 'https://stack-share.example.test');
});

test('getPublicServerUrlEnvOverride expands ~/ explicit env file overrides against HOME', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hstack-server-urls-'));
  const homeDir = join(dir, 'home');
  const envPath = join(homeDir, '.piggercode', 'stacks', 'dev', 'env');
  await mkdir(join(homeDir, '.piggercode', 'stacks', 'dev'), { recursive: true });
  await writeFile(envPath, 'PIGGERCODE_STACK_SERVER_URL=https://stack-share.example.test\n', 'utf-8');

  const out = getPublicServerUrlEnvOverride({
    env: {
      HOME: homeDir,
      PIGGERCODE_STACK_STACK: 'dev',
      PIGGERCODE_STACK_ENV_FILE: '~/.piggercode/stacks/dev/env',
      PIGGERCODE_STACK_SERVER_URL: 'https://stack-share.example.test',
    },
    serverPort: 3005,
  });

  assert.equal(out.envPublicUrl, 'https://stack-share.example.test');
  assert.equal(out.publicServerUrl, 'https://stack-share.example.test');
});

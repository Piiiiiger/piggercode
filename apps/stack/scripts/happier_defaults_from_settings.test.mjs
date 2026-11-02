import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hstackBinPath, runNodeCapture } from './testkit/auth_testkit.mjs';
import { createHappierCliMonorepoFixture } from './testkit/happier_cli_monorepo_testkit.mjs';
import { buildStackStableScopeId } from './utils/auth/stable_scope_id.mjs';
import { sanitizeStackTestRunnerEnv } from './utils/test/test_env.mjs';

async function createMonorepoFixture(t, { prefix }) {
  return createHappierCliMonorepoFixture(t, {
    prefix,
    distIndexScript: [
      "// Parse --server-url from argv",
      "let serverUrlFromArg = null;",
      "for (let i = 0; i < process.argv.length; i++) {",
      "  const arg = process.argv[i];",
      "  if (arg === '--server-url' && i + 1 < process.argv.length) {",
      "    serverUrlFromArg = process.argv[i + 1];",
      "    break;",
      "  }",
      "  if (arg.startsWith('--server-url=')) {",
      "    serverUrlFromArg = arg.slice('--server-url='.length);",
      "    break;",
      "  }",
      "}",
      "console.log(JSON.stringify({",
      "  serverUrl: serverUrlFromArg ?? process.env.PIGGERCODE_SERVER_URL ?? null,",
      "  publicServerUrl: process.env.PIGGERCODE_PUBLIC_SERVER_URL ?? null,",
      "  localServerUrl: process.env.PIGGERCODE_LOCAL_SERVER_URL ?? null,",
      "  webappUrl: process.env.PIGGERCODE_WEBAPP_URL ?? null,",
      "  activeServerId: process.env.PIGGERCODE_ACTIVE_SERVER_ID ?? null,",
      "  homeDir: process.env.PIGGERCODE_HOME_DIR ?? null,",
      "}));",
      '',
    ].join('\n'),
  });
}

function stackRootDirFromMeta(metaUrl) {
  const scriptsDir = dirname(fileURLToPath(metaUrl));
  return dirname(scriptsDir);
}

async function holdEphemeralLoopbackPort(t) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  };
  t.after(release);
  return { port: address.port, release };
}

function buildHappierFixtureEnv({ rootDir, fixtureDir, homeDir, extra = {} }) {
  const env = {
    ...sanitizeStackTestRunnerEnv(process.env, {
      isolatedStackRoot: join(fixtureDir, '.stack-root'),
      repoDir: fixtureDir,
    }),
    PIGGERCODE_STACK_STACK: 'test-stack',
    // Storage is already isolated above; leave the explicit pointer unset so this fixture does not
    // model the now-invalid contract of a configured path that does not exist.
    PIGGERCODE_STACK_ENV_FILE: '',
    PIGGERCODE_STACK_SYNC_BUNDLED_WORKSPACES: '0',
    PIGGERCODE_HOME_DIR: homeDir,
    ...extra,
  };
  delete env.PIGGERCODE_PUBLIC_SERVER_URL;
  delete env.PIGGERCODE_LOCAL_SERVER_URL;
  return env;
}

test('hstack piggercode defaults serverUrl/webappUrl from existing CLI settings (no localServerUrl)', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-settings-defaults-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'http://localhost:53288',
          webappUrl: 'http://happier.example.localhost:19364',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture([hstackBinPath(rootDir), 'piggercode'], { cwd: rootDir, env });
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, 'http://localhost:53288');
  assert.equal(parsed.webappUrl, 'http://happier.example.localhost:19364');
  assert.equal(parsed.publicServerUrl, null);
  assert.equal(parsed.localServerUrl, null);
  assert.equal(parsed.homeDir, homeDir);
});

test('hstack piggercode prefers existing CLI settings over stack defaults even when stack env is pinned', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-settings-cloud-over-stack-' });
  const pinnedPortReservation = await holdEphemeralLoopbackPort(t);

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'cloud',
      servers: {
        cloud: {
          id: 'cloud',
          name: 'cloud',
          serverUrl: 'https://api.happier.dev',
          webappUrl: 'https://app.happier.dev',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({
    rootDir,
    fixtureDir: fixture.dir,
    homeDir,
    extra: { PIGGERCODE_STACK_SERVER_PORT: String(pinnedPortReservation.port) },
  });
  await pinnedPortReservation.release();

  const res = await runNodeCapture([hstackBinPath(rootDir), 'piggercode'], { cwd: rootDir, env });
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, 'https://api.happier.dev');
  assert.equal(parsed.webappUrl, 'https://app.happier.dev');
  assert.equal(parsed.activeServerId, null);
  assert.equal(parsed.homeDir, homeDir);
});

test('hstack piggercode defaults serverUrl via localServerUrl when present in settings', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-settings-local-defaults-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'https://public.example.test',
          localServerUrl: 'http://127.0.0.1:53288',
          webappUrl: 'https://app.example.test',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture([hstackBinPath(rootDir), 'piggercode'], { cwd: rootDir, env });
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.publicServerUrl, 'https://public.example.test');
  assert.equal(parsed.localServerUrl, 'http://127.0.0.1:53288');
  assert.equal(parsed.serverUrl, 'http://127.0.0.1:53288');
  assert.equal(parsed.webappUrl, 'https://app.example.test');
});

test('hstack piggercode treats non-prefix --server as explicit server selection', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-subcommand-server-flag-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'http://localhost:53288',
          webappUrl: 'http://happier.example.localhost:19364',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture(
    [hstackBinPath(rootDir), 'piggercode', 'doctor', '--server', 'example'],
    { cwd: rootDir, env },
  );
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, null, 'serverUrl should not use stack defaults when --server is explicit');
  assert.equal(parsed.webappUrl, null, 'webappUrl should not use stack defaults when --server is explicit');
  assert.equal(parsed.activeServerId, null, 'activeServerId should be cleared when --server is explicit');
});

test('hstack piggercode honors explicit --server-url even when other top-level flags appear first', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-server-url-after-json-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'http://localhost:53288',
          webappUrl: 'http://happier.example.localhost:19364',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture(
    [hstackBinPath(rootDir), 'piggercode', '--json', '--server-url=https://override.example'],
    { cwd: rootDir, env },
  );
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, 'https://override.example', 'serverUrl should use explicit --server-url override');
  assert.notEqual(
    parsed.activeServerId,
    buildStackStableScopeId({ stackName: 'test-stack', cliIdentity: 'default' }),
    'activeServerId should not use stack-stable id when explicit server is selected',
  );
});

test('hstack piggercode honors explicit --server-url after a forwarded subcommand', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-server-url-after-subcommand-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'http://localhost:53288',
          webappUrl: 'http://happier.example.localhost:19364',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture(
    [hstackBinPath(rootDir), 'piggercode', 'auth', 'login', '--server-url=https://override.example'],
    { cwd: rootDir, env },
  );
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, 'https://override.example', 'serverUrl should use explicit --server-url override');
  assert.notEqual(
    parsed.activeServerId,
    buildStackStableScopeId({ stackName: 'test-stack', cliIdentity: 'default' }),
    'activeServerId should not use stack-stable id when explicit server is selected',
  );
});

test('hstack piggercode treats auth subcommand --server as explicit server selection', async (t) => {
  const rootDir = stackRootDirFromMeta(import.meta.url);
  const fixture = await createMonorepoFixture(t, { prefix: 'hstack-happier-auth-server-subcommand-' });

  const homeDir = join(fixture.dir, '.happy-home');
  await mkdir(homeDir, { recursive: true });
  await writeFile(
    join(homeDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 6,
      onboardingCompleted: true,
      activeServerId: 'stack',
      servers: {
        stack: {
          id: 'stack',
          name: 'stack',
          serverUrl: 'http://localhost:53288',
          webappUrl: 'http://happier.example.localhost:19364',
          createdAt: 1,
          updatedAt: 1,
          lastUsedAt: 1,
        },
      },
    }),
    'utf-8',
  );

  const env = buildHappierFixtureEnv({ rootDir, fixtureDir: fixture.dir, homeDir });

  const res = await runNodeCapture(
    [hstackBinPath(rootDir), 'piggercode', 'auth', 'login', '--server', 'example'],
    { cwd: rootDir, env },
  );
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}\nstderr:\n${res.stderr}\nstdout:\n${res.stdout}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.serverUrl, null, 'serverUrl should not use stack defaults when auth forwards --server');
  assert.equal(parsed.webappUrl, null, 'webappUrl should not use stack defaults when auth forwards --server');
  assert.equal(parsed.activeServerId, null, 'activeServerId should be cleared when auth forwards explicit --server');
});

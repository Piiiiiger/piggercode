import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ensureServerSchemaReady } from './startup.mjs';
import { buildServerLightEnv, createServerLightFixture } from './startup_server_light_testkit.mjs';

test('ensureServerSchemaReady bestEffort=true skips the canonical migration dispatcher by default', async (t) => {
  const { binDir, markerPath, root, serverDir } = await createServerLightFixture(t, {
    prefix: 'hs-startup-light-best-effort-',
    socketPort: 54323,
  });
  const env = buildServerLightEnv({ binDir, root });

  const res = await ensureServerSchemaReady({ serverComponentName: 'happier-server-light', serverDir, env, bestEffort: true });
  assert.equal(res.ok, true);
  assert.equal(res.migrated, false);
  assert.equal(res.accountCount, 0);
  assert.equal(existsSync(markerPath), false, `expected bestEffort to skip migrate:deploy (${markerPath})`);
});

test('ensureServerSchemaReady honors HAPPY_SERVER_LIGHT_DATA_DIR legacy fallback', async (t) => {
  const { binDir, markerPath, root, serverDir } = await createServerLightFixture(t, {
    prefix: 'hs-startup-light-legacy-data-dir-',
    socketPort: 54324,
  });

  const dataDir = join(root, 'legacy-data');
  const env = buildServerLightEnv({
    binDir,
    root,
    extraEnv: {
      PIGGERCODE_SERVER_LIGHT_DATA_DIR: undefined,
      PIGGERCODE_SERVER_LIGHT_FILES_DIR: undefined,
      PIGGERCODE_SERVER_LIGHT_DB_DIR: undefined,
      HAPPY_SERVER_LIGHT_DATA_DIR: dataDir,
      PIGGERCODE_SQLITE_BUSY_TIMEOUT_MS: '500',
      PIGGERCODE_SQLITE_CONNECTION_LIMIT: '1',
    },
  });
  delete env.DATABASE_URL;

  assert.equal(existsSync(dataDir), false);
  assert.equal(Boolean(env.DATABASE_URL), false);

  const res = await ensureServerSchemaReady({ serverComponentName: 'happier-server-light', serverDir, env });
  assert.equal(res.ok, true);
  assert.equal(existsSync(dataDir), true);
  assert.equal(Object.hasOwn(env, 'DATABASE_URL'), false, 'schema readiness must not pollute the env reused by dev reloads');
  assert.equal(existsSync(markerPath), true, `expected migrate:deploy to be invoked (${markerPath})`);
});

test('ensureServerSchemaReady falls back to HAPPY_SERVER_LIGHT_DATA_DIR when HAPPIER value is empty', async (t) => {
  const { binDir, markerPath, root, serverDir } = await createServerLightFixture(t, {
    prefix: 'hs-startup-light-empty-prefers-legacy-',
    socketPort: 54325,
  });

  const dataDir = join(root, 'legacy-data-empty-fallback');
  const env = buildServerLightEnv({
    binDir,
    root,
    extraEnv: {
      PIGGERCODE_SERVER_LIGHT_DATA_DIR: '',
      PIGGERCODE_SERVER_LIGHT_FILES_DIR: '',
      PIGGERCODE_SERVER_LIGHT_DB_DIR: '',
      HAPPY_SERVER_LIGHT_DATA_DIR: dataDir,
    },
  });
  delete env.DATABASE_URL;

  assert.equal(existsSync(dataDir), false);
  assert.equal(Boolean(env.DATABASE_URL), false);

  const res = await ensureServerSchemaReady({ serverComponentName: 'happier-server-light', serverDir, env });
  assert.equal(res.ok, true);
  assert.equal(existsSync(dataDir), true);
  assert.equal(Object.hasOwn(env, 'DATABASE_URL'), false, 'schema readiness must not pollute the env reused by dev reloads');
  assert.equal(existsSync(markerPath), true, `expected migrate:deploy to be invoked (${markerPath})`);
});

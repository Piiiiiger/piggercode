import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withStackEnv } from './stack_environment.mjs';

async function withTempStackEnvFixture(fn) {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-stack-env-sanitize-'));
  const storageDir = join(tmp, 'storage');
  const stackName = 'sanitize';
  const stackDir = join(storageDir, stackName);

  await mkdir(stackDir, { recursive: true });
  await writeFile(
    join(stackDir, 'env'),
    [
      'PIGGERCODE_STACK_REPO_DIR=/tmp/happier',
      `PIGGERCODE_STACK_CLI_HOME_DIR=${join(storageDir, stackName, 'cli')}`,
      'PIGGERCODE_STACK_SERVER_PORT=3555',
      '',
    ].join('\n'),
    'utf-8',
  );

  const previousStorageDir = process.env.PIGGERCODE_STACK_STORAGE_DIR;
  process.env.PIGGERCODE_STACK_STORAGE_DIR = storageDir;

  try {
    await fn({ stackName, storageDir });
  } finally {
    if (typeof previousStorageDir === 'undefined') {
      delete process.env.PIGGERCODE_STACK_STORAGE_DIR;
    } else {
      process.env.PIGGERCODE_STACK_STORAGE_DIR = previousStorageDir;
    }
    await rm(tmp, { recursive: true, force: true });
  }
}

test('withStackEnv clears leaked unprefixed server/home env vars from caller scope', async () => {
  await withTempStackEnvFixture(async ({ stackName }) => {
    const previousServerUrl = process.env.PIGGERCODE_SERVER_URL;
    const previousPublicServerUrl = process.env.PIGGERCODE_PUBLIC_SERVER_URL;
    const previousWebappUrl = process.env.PIGGERCODE_WEBAPP_URL;
    const previousHomeDir = process.env.PIGGERCODE_HOME_DIR;
    const previousAppEnv = process.env.APP_ENV;
    const previousExpoUpdatesChannel = process.env.EXPO_UPDATES_CHANNEL;
    const previousExpoPublicFeaturePolicy = process.env.EXPO_PUBLIC_PIGGERCODE_FEATURE_POLICY_ENV;
    const previousExpoPublicBuildFeaturesAllow = process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_ALLOW;
    const previousExpoPublicBuildFeaturesDeny = process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY;
    const previousFeaturePolicyEnv = process.env.PIGGERCODE_FEATURE_POLICY_ENV;
    const previousEmbeddedPolicyEnv = process.env.PIGGERCODE_EMBEDDED_POLICY_ENV;
    const previousBuildFeaturesAllow = process.env.PIGGERCODE_BUILD_FEATURES_ALLOW;
    const previousBuildFeaturesDeny = process.env.PIGGERCODE_BUILD_FEATURES_DENY;

    process.env.PIGGERCODE_SERVER_URL = 'http://stale.localhost:9999';
    process.env.PIGGERCODE_PUBLIC_SERVER_URL = 'http://stale.localhost:9999';
    process.env.PIGGERCODE_WEBAPP_URL = 'http://stale.localhost:9999';
    process.env.PIGGERCODE_HOME_DIR = '/tmp/stale-home';
    process.env.APP_ENV = 'preview';
    process.env.EXPO_UPDATES_CHANNEL = 'preview';
    process.env.EXPO_PUBLIC_PIGGERCODE_FEATURE_POLICY_ENV = 'preview';
    process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_ALLOW = 'voice';
    process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY = 'automations';
    process.env.PIGGERCODE_FEATURE_POLICY_ENV = 'preview';
    process.env.PIGGERCODE_EMBEDDED_POLICY_ENV = 'preview';
    process.env.PIGGERCODE_BUILD_FEATURES_DENY = 'automations';
    process.env.PIGGERCODE_BUILD_FEATURES_ALLOW = 'voice';

    try {
      await withStackEnv({
        stackName,
        fn: async ({ env }) => {
          assert.equal(env.PIGGERCODE_SERVER_URL, undefined);
          assert.equal(env.PIGGERCODE_PUBLIC_SERVER_URL, undefined);
          assert.equal(env.PIGGERCODE_WEBAPP_URL, undefined);
          assert.equal(env.PIGGERCODE_HOME_DIR, undefined);
          assert.equal(env.APP_ENV, undefined);
          assert.equal(env.EXPO_UPDATES_CHANNEL, undefined);
          assert.equal(env.EXPO_PUBLIC_PIGGERCODE_FEATURE_POLICY_ENV, undefined);
          assert.equal(env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY, undefined);
          assert.equal(env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_ALLOW, undefined);
          assert.equal(env.PIGGERCODE_FEATURE_POLICY_ENV, undefined);
          assert.equal(env.PIGGERCODE_EMBEDDED_POLICY_ENV, undefined);
          assert.equal(env.PIGGERCODE_BUILD_FEATURES_DENY, undefined);
          assert.equal(env.PIGGERCODE_BUILD_FEATURES_ALLOW, undefined);
        },
      });
    } finally {
      if (typeof previousServerUrl === 'undefined') delete process.env.PIGGERCODE_SERVER_URL;
      else process.env.PIGGERCODE_SERVER_URL = previousServerUrl;
      if (typeof previousPublicServerUrl === 'undefined') delete process.env.PIGGERCODE_PUBLIC_SERVER_URL;
      else process.env.PIGGERCODE_PUBLIC_SERVER_URL = previousPublicServerUrl;
      if (typeof previousWebappUrl === 'undefined') delete process.env.PIGGERCODE_WEBAPP_URL;
      else process.env.PIGGERCODE_WEBAPP_URL = previousWebappUrl;
      if (typeof previousHomeDir === 'undefined') delete process.env.PIGGERCODE_HOME_DIR;
      else process.env.PIGGERCODE_HOME_DIR = previousHomeDir;
      if (typeof previousAppEnv === 'undefined') delete process.env.APP_ENV;
      else process.env.APP_ENV = previousAppEnv;
      if (typeof previousExpoUpdatesChannel === 'undefined') delete process.env.EXPO_UPDATES_CHANNEL;
      else process.env.EXPO_UPDATES_CHANNEL = previousExpoUpdatesChannel;
      if (typeof previousExpoPublicFeaturePolicy === 'undefined') delete process.env.EXPO_PUBLIC_PIGGERCODE_FEATURE_POLICY_ENV;
      else process.env.EXPO_PUBLIC_PIGGERCODE_FEATURE_POLICY_ENV = previousExpoPublicFeaturePolicy;
      if (typeof previousExpoPublicBuildFeaturesAllow === 'undefined') delete process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_ALLOW;
      else process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_ALLOW = previousExpoPublicBuildFeaturesAllow;
      if (typeof previousExpoPublicBuildFeaturesDeny === 'undefined') delete process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY;
      else process.env.EXPO_PUBLIC_PIGGERCODE_BUILD_FEATURES_DENY = previousExpoPublicBuildFeaturesDeny;
      if (typeof previousFeaturePolicyEnv === 'undefined') delete process.env.PIGGERCODE_FEATURE_POLICY_ENV;
      else process.env.PIGGERCODE_FEATURE_POLICY_ENV = previousFeaturePolicyEnv;
      if (typeof previousEmbeddedPolicyEnv === 'undefined') delete process.env.PIGGERCODE_EMBEDDED_POLICY_ENV;
      else process.env.PIGGERCODE_EMBEDDED_POLICY_ENV = previousEmbeddedPolicyEnv;
      if (typeof previousBuildFeaturesAllow === 'undefined') delete process.env.PIGGERCODE_BUILD_FEATURES_ALLOW;
      else process.env.PIGGERCODE_BUILD_FEATURES_ALLOW = previousBuildFeaturesAllow;
      if (typeof previousBuildFeaturesDeny === 'undefined') delete process.env.PIGGERCODE_BUILD_FEATURES_DENY;
      else process.env.PIGGERCODE_BUILD_FEATURES_DENY = previousBuildFeaturesDeny;
    }
  });
});

test('withStackEnv preserves explicit local stack runtime override env vars from caller scope', async () => {
  await withTempStackEnvFixture(async ({ stackName }) => {
    const previousCliBuild = process.env.PIGGERCODE_STACK_CLI_BUILD;
    const previousSkipRefreshDeps = process.env.PIGGERCODE_STACK_SKIP_REFRESH_DEPS;
    const previousExpoExportMaxWorkers = process.env.PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS;

    process.env.PIGGERCODE_STACK_CLI_BUILD = '0';
    process.env.PIGGERCODE_STACK_SKIP_REFRESH_DEPS = '1';
    process.env.PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS = '2';

    try {
      await withStackEnv({
        stackName,
        fn: async ({ env }) => {
          assert.equal(env.PIGGERCODE_STACK_CLI_BUILD, '0');
          assert.equal(env.PIGGERCODE_STACK_SKIP_REFRESH_DEPS, '1');
          assert.equal(env.PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS, '2');
        },
      });
    } finally {
      if (typeof previousCliBuild === 'undefined') delete process.env.PIGGERCODE_STACK_CLI_BUILD;
      else process.env.PIGGERCODE_STACK_CLI_BUILD = previousCliBuild;
      if (typeof previousSkipRefreshDeps === 'undefined') delete process.env.PIGGERCODE_STACK_SKIP_REFRESH_DEPS;
      else process.env.PIGGERCODE_STACK_SKIP_REFRESH_DEPS = previousSkipRefreshDeps;
      if (typeof previousExpoExportMaxWorkers === 'undefined') delete process.env.PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS;
      else process.env.PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS = previousExpoExportMaxWorkers;
    }
  });
});

test('withStackEnv replaces a foreign daemon lifecycle scope with the selected stack scope', async () => {
  await withTempStackEnvFixture(async ({ stackName }) => {
    const previousActiveServerId = process.env.PIGGERCODE_ACTIVE_SERVER_ID;
    const previousLifecycleScopeId = process.env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID;
    process.env.PIGGERCODE_ACTIVE_SERVER_ID = 'stack_other__id_default';
    process.env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID = 'stack_other__id_default';

    try {
      await withStackEnv({
        stackName,
        reconcileDaemonRuntimeState: false,
        fn: async ({ env }) => {
          assert.equal(env.PIGGERCODE_ACTIVE_SERVER_ID, 'stack_sanitize__id_default');
          assert.equal(env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID, 'stack_sanitize__id_default');
        },
      });
    } finally {
      if (typeof previousActiveServerId === 'undefined') delete process.env.PIGGERCODE_ACTIVE_SERVER_ID;
      else process.env.PIGGERCODE_ACTIVE_SERVER_ID = previousActiveServerId;
      if (typeof previousLifecycleScopeId === 'undefined') delete process.env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID;
      else process.env.PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID = previousLifecycleScopeId;
    }
  });
});

test('withStackEnv does not carry a foreign stack Expo port allocation into the selected stack', async () => {
  await withTempStackEnvFixture(async ({ stackName, storageDir }) => {
    const keys = [
      'PIGGERCODE_STACK_STACK',
      'PIGGERCODE_STACK_ENV_FILE',
      'PIGGERCODE_STACK_EXPO_DEV_PORT',
      'PIGGERCODE_STACK_EXPO_DEV_PORT_STRATEGY',
      'PIGGERCODE_STACK_EXPO_DEV_PORT_BASE',
      'PIGGERCODE_STACK_EXPO_DEV_PORT_RANGE',
    ];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

    process.env.PIGGERCODE_STACK_STACK = 'source-stack';
    process.env.PIGGERCODE_STACK_ENV_FILE = join(storageDir, 'source-stack', 'env');
    process.env.PIGGERCODE_STACK_EXPO_DEV_PORT = '18829';
    process.env.PIGGERCODE_STACK_EXPO_DEV_PORT_STRATEGY = 'stable';
    process.env.PIGGERCODE_STACK_EXPO_DEV_PORT_BASE = '18081';
    process.env.PIGGERCODE_STACK_EXPO_DEV_PORT_RANGE = '2000';

    try {
      await withStackEnv({
        stackName,
        fn: async ({ env }) => {
          assert.equal(env.PIGGERCODE_STACK_STACK, stackName);
          assert.equal(env.PIGGERCODE_STACK_EXPO_DEV_PORT, undefined);
          assert.equal(env.PIGGERCODE_STACK_EXPO_DEV_PORT_STRATEGY, undefined);
          assert.equal(env.PIGGERCODE_STACK_EXPO_DEV_PORT_BASE, undefined);
          assert.equal(env.PIGGERCODE_STACK_EXPO_DEV_PORT_RANGE, undefined);
        },
      });
    } finally {
      for (const key of keys) {
        if (typeof previous[key] === 'undefined') delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
});

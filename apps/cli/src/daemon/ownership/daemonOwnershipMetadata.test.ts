import { describe, expect, it } from 'vitest';

import {
  resolveDaemonStartupSourceFromEnv,
  resolveDaemonStartupSourceServiceManagedState,
} from './daemonOwnershipMetadata';

describe('resolveDaemonStartupSourceFromEnv', () => {
  it('defaults to manual when only service metadata env is present', () => {
    expect(
      resolveDaemonStartupSourceFromEnv({
        PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: 'cloud',
        PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
      } as NodeJS.ProcessEnv),
    ).toBe('manual');
  });

  it('treats an inherited daemon runtime id as self-restart intent', () => {
    expect(
      resolveDaemonStartupSourceFromEnv({
        PIGGERCODE_DAEMON_RUNTIME_ID: 'runtime-1',
      } as NodeJS.ProcessEnv),
    ).toBe('self-restart');
  });

  it('lets an inherited daemon runtime id override an inherited manual startup source', () => {
    expect(
      resolveDaemonStartupSourceFromEnv({
        PIGGERCODE_DAEMON_STARTUP_SOURCE: 'manual',
        PIGGERCODE_DAEMON_RUNTIME_ID: 'runtime-1',
      } as NodeJS.ProcessEnv),
    ).toBe('self-restart');
  });

  it('honors an explicit background-service startup source marker', () => {
    expect(
      resolveDaemonStartupSourceFromEnv({
        PIGGERCODE_DAEMON_STARTUP_SOURCE: 'background-service',
        PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID: 'cloud',
        PIGGERCODE_DAEMON_SERVICE_TARGET_MODE: 'default-following',
      } as NodeJS.ProcessEnv),
    ).toBe('background-service');
  });
});

describe('resolveDaemonStartupSourceServiceManagedState', () => {
  it('treats legacy daemon state without a service label as manual', () => {
    expect(resolveDaemonStartupSourceServiceManagedState(undefined, undefined)).toBe(false);
    expect(resolveDaemonStartupSourceServiceManagedState('unknown', undefined)).toBe(false);
  });

  it('treats legacy daemon state with a service label as service-managed', () => {
    expect(resolveDaemonStartupSourceServiceManagedState(undefined, 'com.piggercode.cli.daemon.default')).toBe(true);
    expect(resolveDaemonStartupSourceServiceManagedState('unknown', 'com.piggercode.cli.daemon.default')).toBe(true);
  });
});

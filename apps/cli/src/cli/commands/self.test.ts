import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeSelfUpdateSpec,
  detectInstallSource,
  packageJsonPathForNodeModules,
  parseSelfChannel,
} from './self';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { STANDARD_MANAGED_CLI_RELEASE_CHANNEL_ENV_KEYS } from '@piggercode/cli-common/firstPartyRuntime';

describe('self command helpers', () => {
  const envScope = createEnvKeyScope(STANDARD_MANAGED_CLI_RELEASE_CHANNEL_ENV_KEYS);

  beforeEach(() => {
    envScope.patch({
      PIGGERCODE_PUBLIC_RELEASE_CHANNEL: undefined,
      PIGGERCODE_RELEASE_RING: undefined,
      PIGGERCODE_RELEASE_CHANNEL: undefined,
    });
  });

  afterEach(() => {
    envScope.restore();
  });

  it('defaults to stable channel', () => {
    expect(parseSelfChannel([])).toBe('stable');
  });

  it.each([
    { args: ['--preview'], expected: 'preview' },
    { args: ['--dev'], expected: 'publicdev' },
    { args: ['--channel=preview'], expected: 'preview' },
    { args: ['--channel=dev'], expected: 'publicdev' },
    { args: ['--channel', 'preview'], expected: 'preview' },
    { args: ['--channel', 'dev'], expected: 'publicdev' },
    { args: ['--channel=stable'], expected: 'stable' },
    { args: ['--channel', 'stable'], expected: 'stable' },
    { args: ['--channel=unknown'], expected: 'stable' },
    { args: ['--channel'], expected: 'stable' },
    { args: ['--preview', '--channel=stable'], expected: 'preview' },
  ])('parses channel flags: $args -> $expected', ({ args, expected }) => {
    expect(parseSelfChannel(args)).toBe(expected);
  });

  it('infers preview and dev from the invoked shim name when no explicit channel is set', () => {
    expect(parseSelfChannel([], '/opt/happier/bin/hprev')).toBe('preview');
    expect(parseSelfChannel([], '/opt/happier/bin/hdev')).toBe('publicdev');
    expect(parseSelfChannel([], '/opt/happier/bin/happier')).toBe('stable');
  });

  it('builds npm spec from channel and override', () => {
    expect(computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'stable', to: '' })).toBe('@piggercode/cli@latest');
    expect(computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'preview', to: '' })).toBe('@piggercode/cli@next');
    expect(computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'publicdev', to: '' })).toBe('@piggercode/cli@next');
    expect(computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'preview', to: '1.2.3' })).toBe('@piggercode/cli@1.2.3');
    expect(computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'stable', to: '  latest  ' })).toBe('@piggercode/cli@latest');
  });

  it('rejects unsafe override specs', () => {
    expect(() =>
      computeSelfUpdateSpec({ packageName: '@piggercode/cli', channel: 'stable', to: '1.2.3 || rm -rf /' }),
    ).toThrow(/invalid --to value/i);
  });

  it('builds node_modules package.json path for valid package names', () => {
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: '@piggercode/cli' }))
      .toBe('/tmp/root/node_modules/@piggercode/cli/package.json');
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: 'chalk' }))
      .toBe('/tmp/root/node_modules/chalk/package.json');
  });

  it('rejects traversal-like package names when building node_modules paths', () => {
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: '../evil' })).toBeNull();
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: '@piggercode/../evil' })).toBeNull();
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: './evil' })).toBeNull();
    expect(packageJsonPathForNodeModules({ rootDir: '/tmp/root', packageName: 'pkg/../../evil' })).toBeNull();
  });

  it('detects npm install source from node_modules paths', () => {
    expect(detectInstallSource('/usr/local/lib/node_modules/@piggercode/cli/bin/happier.mjs')).toBe('npm');
    expect(detectInstallSource('/Users/me/.nvm/versions/node/v22/lib/node_modules/@piggercode/cli/bin/happier.mjs')).toBe('npm');
  });

  it('detects binary install source from standalone executable paths', () => {
    expect(detectInstallSource('/usr/local/bin/happier')).toBe('binary');
    expect(detectInstallSource('/opt/happier/bin/happier')).toBe('binary');
  });
});

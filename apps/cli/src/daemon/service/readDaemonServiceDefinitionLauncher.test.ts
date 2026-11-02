import { describe, expect, it } from 'vitest';

import { buildLaunchdPlistXml, renderSystemdServiceUnit, renderWindowsScheduledTaskWrapperPs1 } from '@piggercode/cli-common/service';

import { describeDaemonServiceRuntimeReplacement, readDaemonServiceDefinitionLauncher } from './readDaemonServiceDefinitionLauncher';

const SPACED = '/Users/Jo & Co/My Apps/happier';

describe('readDaemonServiceDefinitionLauncher', () => {
  it('reads the launcher back from each template this CLI renders, including quoted paths', () => {
    expect(readDaemonServiceDefinitionLauncher({
      platform: 'linux',
      contents: renderSystemdServiceUnit({ description: 'PiggerCode', execStart: [SPACED, 'daemon', 'start-sync'] }),
    })).toEqual([SPACED]);
    expect(readDaemonServiceDefinitionLauncher({
      platform: 'darwin',
      contents: buildLaunchdPlistXml({
        label: 'com.piggercode.cli.daemon.default',
        programArgs: ['/usr/local/bin/node', '/opt/happier/dist/index.mjs', 'daemon', 'start-sync'],
        stdoutPath: '/tmp/out',
        stderrPath: '/tmp/err',
      }),
    })).toEqual(['/usr/local/bin/node', '/opt/happier/dist/index.mjs']);
    expect(readDaemonServiceDefinitionLauncher({
      platform: 'win32',
      contents: renderWindowsScheduledTaskWrapperPs1({ programArgs: ['C:\\Users\\Jo "J"\\piggercode.exe', 'daemon', 'start-sync'] }),
    })).toEqual(['C:\\Users\\Jo "J"\\piggercode.exe']);
  });

  it('reports a replacement whenever the launcher switches between a user-installed CLI and the managed CLI, in either direction (R13)', () => {
    const render = (launcher: string) => renderSystemdServiceUnit({ description: 'PiggerCode', execStart: [launcher, 'daemon', 'start-sync'] });
    const isManagedCliLauncher = (launcher: readonly string[]) => launcher.some((element) => element.startsWith('/home/me/.piggercode/'));
    const replacementFor = (installed: string | null, expected: string) => describeDaemonServiceRuntimeReplacement({
      platform: 'linux',
      installedContents: installed === null ? null : render(installed),
      expectedContents: render(expected),
      isManagedCliLauncher,
    });
    expect(replacementFor('/usr/local/bin/happier', '/home/me/.piggercode/bin/happier'))
      .toEqual({ current: '/usr/local/bin/happier', replacement: '/home/me/.piggercode/bin/happier' });
    // "Keep my own" after the managed CLI ran the service is the same kind of switch, the other way.
    expect(replacementFor('/home/me/.piggercode/bin/happier', '/usr/local/bin/happier'))
      .toEqual({ current: '/home/me/.piggercode/bin/happier', replacement: '/usr/local/bin/happier' });
    expect(replacementFor('/home/me/.piggercode/bin/happier', '/home/me/.piggercode/bin/happier')).toBeNull();
    expect(replacementFor(null, '/home/me/.piggercode/bin/happier')).toBeNull();
    // Drift within one kind is not a switch of which CLI the service runs.
    expect(replacementFor('/home/me/.piggercode/cli/versions/1.0.0/happier', '/home/me/.piggercode/bin/happier')).toBeNull();
    expect(replacementFor('/home/me/.fnm/v20/bin/node', '/home/me/.fnm/v22/bin/node')).toBeNull();
  });
});

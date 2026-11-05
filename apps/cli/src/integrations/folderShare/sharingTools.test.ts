import { describe, expect, it } from 'vitest';

import { buildSandboxedSftpServer, buildSandboxedSftpServerArgs, resolveSharingTools, type RootEntry } from './sharingTools';

describe('the sandbox a shared folder is served from', () => {
  it('holds the system read-only, the shared folder, and nothing else of the computer', () => {
    const layout: Record<string, RootEntry> = {
      '/bin': { type: 'link', target: 'usr/bin' },
      '/lib': { type: 'link', target: 'usr/lib' },
      '/lib64': { type: 'dir' },
    };
    const args = buildSandboxedSftpServerArgs({
      folderPath: '/home/pigger/code',
      homeDir: '/home/pigger',
      sftpServer: '/usr/lib/ssh/sftp-server',
      describeRootEntry: (path) => layout[path] ?? { type: 'none' },
    });

    expect(args.slice(0, 2)).toEqual(['--unshare-all', '--die-with-parent']);
    expect(args.join(' ')).toContain('--ro-bind /usr /usr');
    expect(args.join(' ')).toContain('--symlink usr/bin /bin');
    expect(args.join(' ')).toContain('--symlink usr/lib /lib');
    expect(args.join(' ')).toContain('--ro-bind /lib64 /lib64');
    expect(args.join(' ')).not.toContain('/sbin');
    // The only writable place is the shared folder; the home itself is not mounted.
    expect(args.filter((arg) => arg === '--bind')).toHaveLength(1);
    expect(args.join(' ')).toContain('--bind /home/pigger/code /home/pigger/code');
    expect(args).not.toContain('/home/pigger/.ssh');
    expect(args.slice(-3)).toEqual(['/usr/lib/ssh/sftp-server', '-d', '/home/pigger']);
  });

  it('shares from Linux and macOS, each through its own sandbox, and says what is missing', () => {
    const mac = (present: readonly string[]) => ({
      isExecutable: (path: string) => present.includes(path),
      commandExists: (cmd: string) => cmd === 'ssh',
    });

    expect(resolveSharingTools({ PATH: '/usr/bin' }, 'darwin', mac(['/usr/libexec/sftp-server', '/usr/bin/sandbox-exec']))).toEqual({
      ok: true,
      tools: { ssh: 'ssh', sftpServer: '/usr/libexec/sftp-server', sandbox: { kind: 'seatbelt', command: '/usr/bin/sandbox-exec' } },
    });
    expect(resolveSharingTools({ PATH: '/usr/bin' }, 'darwin', mac(['/usr/libexec/sftp-server']))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('sandbox-exec'),
    });
    expect(resolveSharingTools({ PATH: '' }, 'linux')).toMatchObject({ ok: false, reason: expect.stringMatching(/OpenSSH|bubblewrap/) });
    expect(resolveSharingTools(process.env, 'win32')).toEqual({ ok: false, reason: 'Sharing folders works on Linux and macOS computers.' });
  });

  it('runs sftp-server on a Mac inside the shared folder’s own sandbox profile, with no identity files', () => {
    const server = buildSandboxedSftpServer({
      tools: { ssh: 'ssh', sftpServer: '/usr/libexec/sftp-server', sandbox: { kind: 'seatbelt', command: '/usr/bin/sandbox-exec' } },
      folderPath: '/Users/pigger/code/app',
      homeDir: '/Users/pigger',
      realpath: (path) => path,
    });

    expect(server.command).toBe('/usr/bin/sandbox-exec');
    expect(server.args[0]).toBe('-p');
    expect(server.args[1]).toContain('(allow file-read* file-write* (subpath "/Users/pigger/code/app"))');
    expect(server.args.slice(2)).toEqual(['/usr/libexec/sftp-server', '-d', '/Users/pigger']);
    expect(server.extraInputs).toEqual([]);
  });

  it('runs sftp-server on Linux in bubblewrap, with its user and group on the extra pipes', () => {
    const server = buildSandboxedSftpServer({
      tools: { ssh: 'ssh', sftpServer: '/usr/lib/ssh/sftp-server', sandbox: { kind: 'bubblewrap', command: 'bwrap' } },
      folderPath: '/home/pigger/code',
      homeDir: '/home/pigger',
      identity: () => ({ passwd: 'pigger:x:1000:1000::/home/pigger:/bin/bash\n', group: 'pigger:x:1000:\n' }),
    });

    expect(server.command).toBe('bwrap');
    expect(server.args).toContain('--unshare-all');
    expect(server.args.slice(-3)).toEqual(['/usr/lib/ssh/sftp-server', '-d', '/home/pigger']);
    expect(server.extraInputs).toEqual(['pigger:x:1000:1000::/home/pigger:/bin/bash\n', 'pigger:x:1000:\n']);
  });
});

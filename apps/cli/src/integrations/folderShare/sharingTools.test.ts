import { describe, expect, it } from 'vitest';

import { buildSandboxedSftpServerArgs, resolveSharingTools, type RootEntry } from './sharingTools';

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

  it('is Linux-only for now, and says so elsewhere', () => {
    expect(resolveSharingTools(process.env, 'darwin')).toEqual({ ok: false, reason: 'Sharing folders works on Linux computers for now.' });
    expect(resolveSharingTools({ PATH: '' }, 'linux')).toMatchObject({ ok: false, reason: expect.stringMatching(/OpenSSH|bubblewrap/) });
  });
});

import { describe, expect, it } from 'vitest';

import { buildSeatbeltProfile } from './seatbeltProfile';

const PROFILE_INPUT = {
  folderPath: '/Users/pigger/code/my app',
  homeDir: '/Users/pigger',
  sftpServer: '/usr/libexec/sftp-server',
};

/** The profile's rules, one per line, without comments. */
function rules(profile: string): string[] {
  return profile.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith(';'));
}

describe('the macOS sandbox a shared folder is served from', () => {
  it('denies everything it does not name, and runs only sftp-server', () => {
    const profile = rules(buildSeatbeltProfile(PROFILE_INPUT));

    expect(profile.slice(0, 2)).toEqual(['(version 1)', '(deny default)']);
    expect(profile).toContain('(allow process-exec (literal "/usr/libexec/sftp-server"))');
    expect(profile.filter((rule) => rule.includes('process-exec'))).toHaveLength(1);
    expect(profile.join('\n')).not.toMatch(/network|process-fork/);
  });

  it('lets the server read and change the shared folder, and nothing else of the person’s files', () => {
    const profile = rules(buildSeatbeltProfile(PROFILE_INPUT));

    const writes = profile.filter((rule) => rule.includes('file-write') && !rule.includes('/dev/null'));
    expect(writes).toEqual(['(allow file-read* file-write* (subpath "/Users/pigger/code/my app"))']);
    // Above the folder: each folder's own attributes, never its list or contents.
    expect(profile).toContain(
      '(allow file-read-metadata (literal "/") (literal "/Users") (literal "/Users/pigger") (literal "/Users/pigger/code"))',
    );
    const homeRules = profile.filter((rule) => rule.includes('/Users') && !rule.includes('file-read-metadata'));
    expect(homeRules).toEqual(['(allow file-read* file-write* (subpath "/Users/pigger/code/my app"))']);
    expect(profile.join('\n')).not.toMatch(/\(subpath "\/Users"\)|\(subpath "\/Users\/pigger"\)/);
  });

  it('allows the system files sftp-server starts from, read-only', () => {
    const profile = rules(buildSeatbeltProfile(PROFILE_INPUT)).join('\n');

    expect(profile).toContain('(subpath "/System")');
    expect(profile).toContain('(subpath "/usr/lib")');
    expect(profile).toContain('(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))');
    expect(profile).toContain('(allow file-read-data (literal "/"))');
  });

  it('reaches a folder through a symlink by its real path, and quotes names that need it', () => {
    const profile = rules(buildSeatbeltProfile({
      folderPath: '/Users/pigger/link "q"\\x',
      realFolderPath: '/Volumes/Data/code/q',
      homeDir: '/Users/pigger',
      sftpServer: '/usr/libexec/sftp-server',
    }));

    expect(profile).toContain('(allow file-read* file-write* (subpath "/Volumes/Data/code/q"))');
    // The path it is asked for passes the link itself, so the link's own attributes are readable too.
    const metadata = profile.find((rule) => rule.startsWith('(allow file-read-metadata (literal "/")'));
    expect(metadata).toContain('(literal "/Users/pigger/link \\"q\\"\\\\x")');
    expect(metadata).toContain('(literal "/Volumes/Data/code")');
    expect(profile.join('\n')).not.toContain('(subpath "/Users/pigger/link');
  });
});

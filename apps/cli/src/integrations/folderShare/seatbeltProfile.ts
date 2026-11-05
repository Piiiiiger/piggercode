/**
 * The macOS sandbox (Seatbelt, run through `sandbox-exec -p`) that sftp-server serves one shared
 * folder from. Everything it does not name is denied: the shared folder can be read and changed; the
 * folders above it show only their own attributes (not what is in them), which reaching the folder
 * needs; sftp-server may read the system files it starts from. No network, no other programs.
 *
 * Seatbelt matches the path a file is reached by once symlinks resolve, so the folder is allowed by
 * its real path. Checked on macOS 14 and 26 by driving sftp-server the way sshfs does: escapes through
 * symlinks, renames and hard links are all refused (a hard link needs read access to its source).
 *
 * Self-contained, with no project imports, so the profile can be checked directly on a Mac.
 */
export function buildSeatbeltProfile(params: Readonly<{
  folderPath: string;
  /** The folder's path with symlinks resolved, when that differs from `folderPath`. */
  realFolderPath?: string;
  homeDir: string;
  sftpServer: string;
}>): string {
  const folder = params.realFolderPath ?? params.folderPath;
  const above = new Set([
    ...ancestorsOf(folder),
    ...ancestorsOf(params.folderPath),
    // Reached through a symlink: the link itself is on the way.
    ...(folder === params.folderPath ? [] : [params.folderPath]),
    // sftp-server starts there, and the server names the folder relative to it.
    params.homeDir,
  ]);
  return [
    '(version 1)',
    '(deny default)',
    `(allow process-exec (literal ${quote(params.sftpServer)}))`,
    ...SYSTEM_RULES,
    `(allow file-read-metadata ${[...above].map((path) => `(literal ${quote(path)})`).join(' ')})`,
    `(allow file-read* file-write* (subpath ${quote(folder)}))`,
  ].join('\n');
}

/** What sftp-server needs from the system to start and run. None of it holds anyone's files. */
const SYSTEM_RULES = [
  // Libraries and the dyld cache, read-only.
  '(allow file-read* file-map-executable (subpath "/usr/lib") (subpath "/usr/libexec") (subpath "/System") (subpath "/private/var/db/dyld") (subpath "/Library/Apple"))',
  '(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/private/etc/localtime") (subpath "/private/var/db/timezone") (subpath "/usr/share/zoneinfo"))',
  // /etc, /var and /tmp are symlinks into /private; the time zone is reached through them.
  '(allow file-read-metadata (literal "/etc") (literal "/var") (literal "/tmp"))',
  '(allow file-write-data (literal "/dev/null"))',
  '(allow sysctl-read)',
  // Its own user's name, which sftp-server looks up at start.
  '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))',
  // Logging and dtrace, which it tries at start and does without: refused without a log line each time.
  '(deny mach-lookup (global-name "com.apple.logd") (global-name "com.apple.system.notification_center") (with no-log))',
  '(deny file-read-data (literal "/dev/dtracehelper") (with no-log))',
  // The root folder's list, which sftp-server reads at start.
  '(allow file-read-data (literal "/"))',
];

/** `/a/b/c` → `/`, `/a`, `/a/b`. */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return ['/', ...parts.slice(0, -1).map((_, index) => `/${parts.slice(0, index + 1).join('/')}`)];
}

function quote(path: string): string {
  return `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

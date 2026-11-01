export type SshAddress = Readonly<{ user: string; host: string; port: number }>;

export type SharedFolderMountPlatform = 'linux' | 'macos';

export type SharedFolderMountCommands = Readonly<{
    install: string;
    check: string;
    mount: string;
    unmount: string;
}>;

const SSH_ADDRESS = /^([A-Za-z0-9._-]+)@(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/;

/** Reads `user@host` or `user@host:port` (IPv6 hosts in brackets); the port defaults to 22. */
export function parseSshAddress(raw: string): SshAddress | null {
    const match = SSH_ADDRESS.exec(raw.trim());
    if (!match) return null;
    const [, user, rawHost, rawPort] = match;
    const port = rawPort === undefined ? 22 : Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const host = rawHost!.startsWith('[') ? rawHost!.slice(1, -1) : rawHost!;
    return { user: user!, host, port };
}

/** Installs SSHFS on the computer that mounts the folder; the server needs nothing new. */
export function sharedFolderInstallCommand(platform: SharedFolderMountPlatform): string {
    // macOS uses FUSE-T, which needs no kernel extension; Homebrew disabled the macFUSE sshfs
    // formula in February 2026. The Linux command is Arch's; the guide names Debian/Ubuntu's.
    return platform === 'macos'
        ? 'brew tap macos-fuse-t/homebrew-cask\nbrew install --cask fuse-t fuse-t-sshfs'
        : 'sudo pacman -S sshfs';
}

// Characters a POSIX shell (bash or zsh) passes through unquoted. Brackets are glob characters.
const PLAIN_SHELL_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellWord(value: string): string {
    return PLAIN_SHELL_WORD.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** sshfs reads a remote path without a leading slash as relative to the remote user's home. */
function toRemotePath(sharedFolderPath: string): string {
    const trimmed = sharedFolderPath.trim();
    if (trimmed === '~') return '';
    const relativeToHome = trimmed.startsWith('~/') ? trimmed.slice(2) : trimmed;
    const withoutTrailingSlash = relativeToHome.replace(/\/+$/g, '');
    return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : relativeToHome;
}

export function buildSharedFolderMountCommands(input: Readonly<{
    platform: SharedFolderMountPlatform;
    address: SshAddress;
    sharedFolderPath: string;
    mountDirName: string;
}>): SharedFolderMountCommands {
    const { user, host, port } = input.address;
    const portArgs = port === 22 ? '' : `-p ${port} `;
    const sshDestination = `${user}@${host}`;
    // sshfs separates host and path with a colon, so an IPv6 host goes in brackets there.
    const sshfsHost = host.includes(':') ? `[${host}]` : host;
    const remote = shellWord(`${user}@${sshfsHost}:${toRemotePath(input.sharedFolderPath)}`);
    const mountPoint = `~/${input.mountDirName}`;
    return {
        install: sharedFolderInstallCommand(input.platform),
        check: `ssh ${portArgs}${sshDestination} echo ok`,
        mount: `mkdir -p ${mountPoint} && sshfs ${portArgs}${remote} ${mountPoint} -o reconnect,ServerAliveInterval=15`,
        unmount: input.platform === 'macos' ? `umount ${mountPoint}` : `fusermount3 -u ${mountPoint}`,
    };
}

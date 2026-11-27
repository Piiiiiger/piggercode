import { execFile } from 'node:child_process';
import { mkdir, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** How long the namespace check may take. */
export const AGY_NAMESPACE_CHECK_TIMEOUT_MS = 10_000;

/** Where agy keeps the login's token, under a home (agy rewrites the file in place). */
const AGY_TOKEN_PATH_PARTS = ['.gemini', 'antigravity-cli', 'antigravity-oauth-token'] as const;
/** The other place a login lives: agy replaces files in this folder by rename, so the folder is what moves. */
const AGY_CREDENTIAL_DIR_PARTS = ['.config', 'antigravity'] as const;

export const agyTokenPath = (homeDir: string): string => join(homeDir, ...AGY_TOKEN_PATH_PARTS);
export const agyCredentialDir = (homeDir: string): string => join(homeDir, ...AGY_CREDENTIAL_DIR_PARTS);

/**
 * agy's real home keeps the conversations; a login other than the default one only swaps the two places
 * above. In a private user + mount namespace (so the swap is invisible outside agy) the login's token file
 * and credential folder are bound over the real ones; `HOME`, the environment and the working folder stay,
 * so tools and conversations are the default login's. The login folder and the agy command are positional
 * arguments of `sh`, never part of its script. `setpriv` drops the namespace's capabilities before agy runs.
 * Linux only. `sudo` cannot work inside it (a setuid program in a user namespace).
 */
const NAMESPACE_SCRIPT = [
  `mount --bind "$1/${AGY_TOKEN_PATH_PARTS.join('/')}" "$HOME/${AGY_TOKEN_PATH_PARTS.join('/')}"`,
  `mount --bind "$1/${AGY_CREDENTIAL_DIR_PARTS.join('/')}" "$HOME/${AGY_CREDENTIAL_DIR_PARTS.join('/')}"`,
  'shift',
  'exec setpriv --ambient-caps=-all --inh-caps=-all -- "$@"',
].join(' && ');

const UNSHARE_ARGS = ['--user', '--map-current-user', '--keep-caps', '--mount'] as const;

/** The command that runs `command args` on the login in `accountHomeDir`. */
export function wrapAgyLaunchInLoginNamespace(params: Readonly<{
  accountHomeDir: string;
  cli: Readonly<{ command: string; args: readonly string[] }>;
}>): Readonly<{ command: string; args: string[] }> {
  return {
    command: 'unshare',
    args: [...UNSHARE_ARGS, 'sh', '-c', NAMESPACE_SCRIPT, 'sh', params.accountHomeDir, params.cli.command, ...params.cli.args],
  };
}

/**
 * Makes sure the real home has something for the login's files to be bound over: an empty token file where the
 * default login never signed in (agy reads an empty file as "not signed in"; nothing is written to it), and the
 * credential folder. Existing files are not touched.
 */
export async function prepareAgyLoginMountPoints(realHomeDir: string): Promise<void> {
  const token = agyTokenPath(realHomeDir);
  await mkdir(dirname(token), { recursive: true, mode: 0o700 });
  // `wx`: creates only when it is not there, so a real token is never opened for writing.
  await open(token, 'wx', 0o600).then((handle) => handle.close(), (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await mkdir(agyCredentialDir(realHomeDir), { recursive: true, mode: 0o700 });
}

/** A login folder agy can run on: it has a token (a login that was started and never finished has none). */
export async function isAgyLoginComplete(accountHomeDir: string): Promise<boolean> {
  const token = await stat(agyTokenPath(accountHomeDir)).catch(() => null);
  const credentials = await stat(agyCredentialDir(accountHomeDir)).catch(() => null);
  return Boolean(token?.isFile() && token.size > 0 && credentials?.isDirectory());
}

export type AgyNamespaceSupport = Readonly<{ ok: true } | { ok: false; reason: string }>;

/**
 * Whether this machine lets agy run in the namespace above (a kernel can turn off unprivileged user
 * namespaces; `unshare`, `mount` and `setpriv` can be missing). Asked once per process: it is a property of
 * the machine, and a failure names its cause so the login is excluded with a reason, not silently skipped.
 */
export function createAgyNamespaceSupportCheck(params: Readonly<{
  platform?: NodeJS.Platform;
  run?: (command: string, args: readonly string[]) => Promise<void>;
}> = {}): () => Promise<AgyNamespaceSupport> {
  const platform = params.platform ?? process.platform;
  const run = params.run ?? (async (command, args) => {
    await execFileAsync(command, [...args], { timeout: AGY_NAMESPACE_CHECK_TIMEOUT_MS });
  });
  let result: Promise<AgyNamespaceSupport> | null = null;
  return () => (result ??= (async (): Promise<AgyNamespaceSupport> => {
    if (platform !== 'linux') return { ok: false, reason: 'agy logins other than the default one need Linux' };
    try {
      await run('unshare', [...UNSHARE_ARGS, 'setpriv', '--ambient-caps=-all', '--inh-caps=-all', 'true']);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  })());
}

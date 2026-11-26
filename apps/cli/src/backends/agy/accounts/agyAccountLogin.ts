import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AGY_DEFAULT_ACCOUNT_ID, type AgyAccountLoginErrorCode } from '@piggercode/protocol';

import { logger } from '@/ui/logger';

import { AGY_LOGIN_FOLDER_NAME } from './agyAccountUsageOwner';
import type { AgyAccountUsageReading } from './readAgyAccountUsageFromStatus';
import { isProcessRunning, killProcessGroup, parsePanePid, probeEnv, runTmuxCommand, type RunTmux } from './probeAgyAccountUsage';

/** The relay gives a machine RPC 30 s: each step answers well inside it. */
const STEP_BUDGET_MS = 20_000;
/**
 * An attempt nobody finishes stops after this, so a forgotten dialog does not keep agy running. A Google
 * sign-in with two-step verification fits well inside it.
 */
const ATTEMPT_LIFETIME_MS = 15 * 60_000;
const POLL_MS = 250;
/** How long agy gets to quit after its terminal closes before it is killed. */
const QUIT_GRACE_MS = 2_000;
const SESSION = 'login';
/** A login being added lives under this prefix, which no login name can start with, until it has signed in. */
const PENDING_PREFIX = '.adding-';
/** A login on its way out: renamed first, so it leaves the list at once, then deleted. */
const REMOVING_PREFIX = '.removing-';
/** Where agy keeps a login's token, under its home. Only whether it exists is checked: nothing here opens it. */
const TOKEN_PATH = ['.gemini', 'antigravity-cli', 'antigravity-oauth-token'] as const;
const GOOGLE_SIGN_IN_URL = /https:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"'<>]+/u;

export type AgyAccountLoginStartResult =
  | Readonly<{ ok: true; loginId: string; accountId: string; url: string }>
  | Readonly<{ ok: false; errorCode: AgyAccountLoginErrorCode }>;

export type AgyAccountLoginSubmitResult =
  /** `replaced`: the Google account was already an added login, which was signed in again in place. */
  | Readonly<{ ok: true; accountId: string; replaced?: true }>
  | Readonly<{ ok: false; errorCode: AgyAccountLoginErrorCode }>;

export type AgyAccountLoginRemoveResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errorCode: AgyAccountLoginErrorCode }>;

/** A login the machine lists, with the Google account it last showed. */
export type AgyListedLogin = Readonly<{ accountId: string; email: string | null }>;

export type AgyAccountLogins = Readonly<{
  /** Makes a new login folder and starts the official agy in it, up to Google's sign-in page. */
  start: () => Promise<AgyAccountLoginStartResult>;
  /**
   * Types the code Google showed into that agy; once agy has signed in, the login joins this machine's list.
   * A paste that is no code leaves the attempt open for another paste; any other failure ends it.
   */
  submit: (loginId: string, input: string) => Promise<AgyAccountLoginSubmitResult>;
  /** Stops that agy and removes a folder that never signed in. */
  cancel: (loginId: string) => Promise<void>;
  /** Removes an added login: its folder (a link to one loses only the link). The main login stays. */
  remove: (accountId: string) => Promise<AgyAccountLoginRemoveResult>;
  /** Ends every open attempt (the daemon is stopping). */
  dispose: () => Promise<void>;
}>;

type FinishResult = AgyAccountLoginSubmitResult;

type Attempt = {
  readonly loginId: string;
  readonly accountId: string;
  /** The folder agy runs in while the login is added: hidden from the login list until it has signed in. */
  readonly pendingHome: string;
  /** When the step that may finish this attempt has to answer by (the relay's RPC deadline). */
  stepDeadline: number;
  readonly dir: string;
  readonly socket: string;
  readonly env: NodeJS.ProcessEnv;
  pid: number | null;
  expiry: ReturnType<typeof setTimeout> | null;
  /** submit, cancel and the lifetime run one at a time on an attempt. */
  turn: Promise<unknown>;
};

/** The first free letter, as the app names new accounts; then the letters again with a number. */
export function nextAgyLoginName(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let round = 1; ; round += 1) {
    for (let code = 'a'.charCodeAt(0); code <= 'z'.charCodeAt(0); code += 1) {
      const candidate = round === 1 ? String.fromCharCode(code) : `${String.fromCharCode(code)}${round}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}

/** What the person pasted: the code Google showed, or the whole address the browser came back to. */
export function readAuthorizationCode(input: string): string | null {
  const text = input.trim();
  if (/^https?:\/\//iu.test(text)) {
    try {
      const code = new URL(text).searchParams.get('code')?.trim() ?? '';
      return code ? readAuthorizationCode(code) : null;
    } catch {
      return null;
    }
  }
  // One printable token that cannot read as an option: nothing else may reach agy's input.
  return /^[\x21-\x2c\x2e-\x7e][\x21-\x7e]{3,4095}$/u.test(text) ? text : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adds a Google login to agy on this machine the way agy itself signs in on a computer without a browser: the
 * official agy runs in a new login folder, shows Google's sign-in page, and takes the code Google shows back.
 * agy keeps the token in that folder; this only checks that it is there. Linux only, as the usage page: elsewhere
 * agy may keep a login in the system keyring, which a separate home does not separate.
 */
export function createAgyAccountLogins(params: Readonly<{
  accountsDir: string;
  platform?: NodeJS.Platform;
  resolveAgy: () => Readonly<{ command: string; args: readonly string[] }> | null;
  /**
   * Which Google account a login that just signed in belongs to: starts agy once on that folder, as the usage
   * page's refresh does, and answers with what agy showed, or null when it showed nothing in time.
   */
  identify: (homeDir: string, timeoutMs: number) => Promise<AgyAccountUsageReading | null>;
  /** The machine's logins, the main one included, with the Google account each last showed. */
  listLogins: () => Promise<readonly AgyListedLogin[]>;
  /** A login has signed in and joined the list, with what agy showed for it when it was identified. */
  onSignedIn: (accountId: string, reading: AgyAccountUsageReading | null) => void;
  /** A login has left the list. */
  onRemoved: (accountId: string) => void;
  runTmux?: RunTmux;
  isRunning?: (pid: number) => boolean;
  killGroup?: (pid: number) => void;
  pollMs?: number;
  stepBudgetMs?: number;
  lifetimeMs?: number;
  quitGraceMs?: number;
}>): AgyAccountLogins {
  const runTmux = params.runTmux ?? runTmuxCommand;
  const isRunning = params.isRunning ?? isProcessRunning;
  const pollMs = params.pollMs ?? POLL_MS;
  const stepBudgetMs = params.stepBudgetMs ?? STEP_BUDGET_MS;
  const attempts = new Map<string, Attempt>();

  const inTurn = <T>(attempt: Attempt, work: () => Promise<T>): Promise<T> => {
    const result = attempt.turn.then(work);
    attempt.turn = result.catch(() => undefined);
    return result;
  };

  const tmux = (attempt: Attempt, args: readonly string[]) => runTmux(['-S', attempt.socket, ...args], attempt.env);
  const screen = (attempt: Attempt) => tmux(attempt, ['capture-pane', '-p', '-J', '-t', SESSION]).catch(() => '');
  const signedIn = (home: string) => stat(join(home, ...TOKEN_PATH)).then((info) => info.isFile(), () => false);
  const agyQuit = (attempt: Attempt) => attempt.pid !== null && !isRunning(attempt.pid);
  const isOpen = (attempt: Attempt) => attempts.get(attempt.loginId) === attempt;

  /** Stops agy and its private tmux server, and drops the attempt. The login folder is left to the caller. */
  const stopAgy = async (attempt: Attempt): Promise<void> => {
    if (attempt.expiry) clearTimeout(attempt.expiry);
    attempts.delete(attempt.loginId);
    // A `new-session` that timed out may still have started agy.
    attempt.pid ??= parsePanePid(await tmux(attempt, ['list-panes', '-a', '-F', '#{pane_pid}']).catch(() => ''));
    await tmux(attempt, ['kill-server']).catch(() => undefined);
    if (attempt.pid !== null) {
      const giveUpAt = Date.now() + (params.quitGraceMs ?? QUIT_GRACE_MS);
      while (isRunning(attempt.pid) && Date.now() < giveUpAt) await pause(50);
      if (isRunning(attempt.pid)) (params.killGroup ?? killProcessGroup)(attempt.pid);
    }
    await rm(attempt.dir, { recursive: true, force: true }).catch(() => undefined);
  };

  /**
   * Everything that changes the folder list runs one at a time: a start picking its name and clearing leftovers,
   * a signed-in login joining or replacing another, a removal. A start never sees a replacement half done.
   */
  let folderTurn: Promise<unknown> = Promise.resolve();
  const inFolderTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const result = folderTurn.then(work);
    folderTurn = result.catch(() => undefined);
    return result;
  };

  /** Takes a folder out of the list at once (a rename), then deletes it; a link loses only the link. */
  const discard = async (path: string, name: string): Promise<void> => {
    const trash = join(params.accountsDir, `${REMOVING_PREFIX}${name}-${randomUUID()}`);
    await rename(path, trash);
    await rm(trash, { recursive: true, force: true }).catch((error: unknown) => {
      // Out of the list already; the next start clears what is left.
      logger.infoFile('[agy-accounts] Could not delete a removed login', error instanceof Error ? error.message : String(error));
    });
  };

  /**
   * A signed-in login joins the list. One Google account is listed once, as on CLIProxyAPI: signing in again with
   * an account that is already an added login signs that login in again, under its name; the main login's own
   * account is refused, since agy signs that one in itself. A login whose account agy did not show in time joins
   * as a new one.
   */
  const place = async (attempt: Attempt, reading: AgyAccountUsageReading | null): Promise<FinishResult> => {
    const email = reading?.email?.trim().toLowerCase() || null;
    const same = email
      ? (await params.listLogins()).find((login) => login.email?.trim().toLowerCase() === email) ?? null
      : null;
    if (same?.accountId === AGY_DEFAULT_ACCOUNT_ID) {
      await rm(attempt.pendingHome, { recursive: true, force: true });
      return { ok: false, errorCode: 'account_is_main_login' };
    }
    if (same) {
      const target = join(params.accountsDir, same.accountId);
      const old = join(params.accountsDir, `${REMOVING_PREFIX}${same.accountId}-${randomUUID()}`);
      await rename(target, old);
      try {
        await rename(attempt.pendingHome, target);
      } catch (error) {
        await rename(old, target).catch(() => undefined);
        throw error;
      }
      await rm(old, { recursive: true, force: true }).catch(() => undefined);
      params.onSignedIn(same.accountId, reading);
      return { ok: true, accountId: same.accountId, replaced: true };
    }
    await rename(attempt.pendingHome, join(params.accountsDir, attempt.accountId));
    params.onSignedIn(attempt.accountId, reading);
    return { ok: true, accountId: attempt.accountId };
  };

  /** A signed-in login is identified and joins the list; null while it has not signed in. */
  const finish = async (attempt: Attempt): Promise<FinishResult | null> => {
    if (!(await signedIn(attempt.pendingHome))) return null;
    await stopAgy(attempt);
    const timeoutMs = attempt.stepDeadline - Date.now();
    const reading = timeoutMs > 0
      ? await params.identify(attempt.pendingHome, timeoutMs).catch((error: unknown) => {
        logger.infoFile('[agy-accounts] Could not tell which account a new login is', error instanceof Error ? error.message : String(error));
        return null;
      })
      : null;
    if (!reading?.email) logger.infoFile('[agy-accounts] agy did not show which account a new login is: adding it as a new one');
    return await inFolderTurn(() => place(attempt, reading));
  };

  /** Ends an open attempt. A folder that never signed in only holds agy's first-run files and goes. */
  const abandon = async (attempt: Attempt): Promise<void> => {
    if (!isOpen(attempt)) return;
    attempt.stepDeadline = Date.now() + stepBudgetMs;
    if (await finish(attempt).catch(() => null)) return;
    await stopAgy(attempt);
    // A login that signed in but could not take its name is kept: removing it would sign the person out.
    if (await signedIn(attempt.pendingHome)) {
      logger.infoFile('[agy-accounts] A new login signed in but could not join the list');
      return;
    }
    await rm(attempt.pendingHome, { recursive: true, force: true }).catch((error: unknown) => {
      logger.infoFile('[agy-accounts] Could not remove an unfinished login', error instanceof Error ? error.message : String(error));
    });
  };

  /** Folders a stopped daemon left half-added go, unless they did sign in, and so do half-removed ones. */
  const removeLeftovers = async (names: readonly string[]): Promise<void> => {
    const open = new Set([...attempts.values()].map((attempt) => attempt.pendingHome));
    await Promise.all(names
      .filter((name) => name.startsWith(REMOVING_PREFIX))
      .map((name) => rm(join(params.accountsDir, name), { recursive: true, force: true }).catch(() => undefined)));
    await Promise.all(names
      .filter((name) => name.startsWith(PENDING_PREFIX))
      .map((name) => join(params.accountsDir, name))
      .filter((path) => !open.has(path))
      .map(async (path) => {
        if (await signedIn(path)) return;
        await rm(path, { recursive: true, force: true }).catch(() => undefined);
      }));
  };

  /** Picks the new login's name and makes its hidden folder: the part two starts must not do at once. */
  const reserve = async (): Promise<Attempt> => {
    await mkdir(params.accountsDir, { recursive: true, mode: 0o700 });
    const names = await readdir(params.accountsDir);
    await removeLeftovers(names);
    const accountId = nextAgyLoginName([
      AGY_DEFAULT_ACCOUNT_ID,
      ...names.filter((name) => AGY_LOGIN_FOLDER_NAME.test(name) || name.startsWith(PENDING_PREFIX))
        .map((name) => (name.startsWith(PENDING_PREFIX) ? name.slice(PENDING_PREFIX.length) : name)),
      ...[...attempts.values()].map((attempt) => attempt.accountId),
    ]);
    const pendingHome = join(params.accountsDir, `${PENDING_PREFIX}${accountId}`);
    await mkdir(pendingHome, { mode: 0o700 });
    let dir: string;
    try {
      dir = await mkdtemp(join(tmpdir(), 'pc-agy-login-'));
      await mkdir(join(dir, 'cwd'));
      await mkdir(join(dir, 'run'), { mode: 0o700 });
    } catch (error) {
      await rm(pendingHome, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const attempt: Attempt = {
      loginId: randomUUID(),
      accountId,
      pendingHome,
      stepDeadline: 0,
      dir,
      socket: join(dir, 't'),
      env: probeEnv(join(dir, 'state.json'), pendingHome, join(dir, 'run')),
      pid: null,
      expiry: null,
      turn: Promise.resolve(),
    };
    attempts.set(attempt.loginId, attempt);
    attempt.expiry = setTimeout(() => void inTurn(attempt, () => abandon(attempt)), params.lifetimeMs ?? ATTEMPT_LIFETIME_MS);
    attempt.expiry.unref?.();
    return attempt;
  };

  const startNow = async (): Promise<AgyAccountLoginStartResult> => {
    if ((params.platform ?? process.platform) !== 'linux') return { ok: false, errorCode: 'unsupported_platform' };
    const agy = params.resolveAgy();
    if (!agy) return { ok: false, errorCode: 'agy_not_installed' };
    const attempt = await inFolderTurn(reserve);
    const { accountId, dir } = attempt;

    try {
      // Wide enough that agy prints Google's address on one line.
      const printed = await tmux(attempt, [
        '-f', '/dev/null', 'new-session', '-d', '-s', SESSION, '-P', '-F', '#{pane_pid}', '-x', '1000', '-y', '50',
        '-c', join(dir, 'cwd'), agy.command, ...agy.args,
      ]);
      attempt.pid = parsePanePid(printed);
      const deadline = Date.now() + stepBudgetMs;
      let choseGoogle = false;
      while (Date.now() < deadline && !agyQuit(attempt) && isOpen(attempt)) {
        const text = await screen(attempt);
        const url = text.match(GOOGLE_SIGN_IN_URL)?.[0];
        if (url) return { ok: true, loginId: attempt.loginId, accountId, url };
        // A new login first asks how to sign in; Google sign-in is the first choice.
        if (!choseGoogle && /Select login method/u.test(text) && /Google OAuth/u.test(text)) {
          await tmux(attempt, ['send-keys', '-t', SESSION, 'Enter']);
          choseGoogle = true;
        }
        await pause(pollMs);
      }
      logger.infoFile('[agy-accounts] agy did not show Google sign-in for a new login');
    } catch (error) {
      logger.infoFile('[agy-accounts] Could not start agy for a new login', error instanceof Error ? error.message : String(error));
    }
    if (!isOpen(attempt)) {
      // Ended while agy started (the daemon is stopping): the stop may have come before agy had a pid.
      if (attempt.pid !== null && isRunning(attempt.pid)) (params.killGroup ?? killProcessGroup)(attempt.pid);
      return { ok: false, errorCode: 'login_failed' };
    }
    await inTurn(attempt, () => abandon(attempt));
    return { ok: false, errorCode: 'login_page_not_shown' };
  };

  const submitNow = async (attempt: Attempt, input: string): Promise<AgyAccountLoginSubmitResult> => {
    // It may have ended while this waited its turn.
    if (!isOpen(attempt)) return { ok: false, errorCode: 'login_not_found' };
    attempt.stepDeadline = Date.now() + stepBudgetMs;
    const finishedBefore = await finish(attempt);
    if (finishedBefore) return finishedBefore;
    const code = readAuthorizationCode(input);
    // Nothing was typed: agy still waits for a code, so the person can paste again.
    if (!code) return { ok: false, errorCode: 'code_unreadable' };
    try {
      await tmux(attempt, ['send-keys', '-t', SESSION, '-l', '--', code]);
      await tmux(attempt, ['send-keys', '-t', SESSION, 'Enter']);
      while (Date.now() < attempt.stepDeadline && !agyQuit(attempt)) {
        const finished = await finish(attempt);
        if (finished) return finished;
        await pause(pollMs);
      }
      const finished = await finish(attempt);
      if (finished) return finished;
    } catch (error) {
      logger.infoFile('[agy-accounts] Could not hand the code to agy', error instanceof Error ? error.message : String(error));
      await abandon(attempt);
      return { ok: false, errorCode: 'login_failed' };
    }
    // agy took the code but did not sign in: a fresh start gets a fresh page and code.
    await abandon(attempt);
    return { ok: false, errorCode: 'code_not_accepted' };
  };

  return {
    start: startNow,
    submit: async (loginId, input) => {
      const attempt = attempts.get(loginId);
      if (!attempt) return { ok: false, errorCode: 'login_not_found' };
      return await inTurn(attempt, () => submitNow(attempt, input));
    },
    cancel: async (loginId) => {
      const attempt = attempts.get(loginId);
      if (attempt) await inTurn(attempt, () => abandon(attempt));
    },
    remove: (accountId) => inFolderTurn(async (): Promise<AgyAccountLoginRemoveResult> => {
      if (accountId === AGY_DEFAULT_ACCOUNT_ID) return { ok: false, errorCode: 'login_not_removable' };
      if (!AGY_LOGIN_FOLDER_NAME.test(accountId)) return { ok: false, errorCode: 'invalid_parameters' };
      const path = join(params.accountsDir, accountId);
      // Already gone counts as removed: the person sees the same list either way.
      const present = await lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
      if (present) await discard(path, accountId);
      params.onRemoved(accountId);
      return { ok: true };
    }),
    dispose: async () => {
      await Promise.all([...attempts.values()].map((attempt) => inTurn(attempt, () => abandon(attempt))));
    },
  };
}

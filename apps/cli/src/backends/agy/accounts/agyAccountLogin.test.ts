import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgyAccountLogins, readAuthorizationCode } from './agyAccountLogin';

const AGY = { command: 'agy', args: [] };
const PANE_PID = 5151;
const SIGN_IN_URL = 'https://accounts.google.com/o/oauth2/auth?client_id=x.apps.googleusercontent.com&state=s1&code_challenge=c1';
const TOKEN = ['.gemini', 'antigravity-cli', 'antigravity-oauth-token'] as const;

/** tmux and the process table are the boundary: this plays agy's sign-in screens, one private server per login. */
function fakeAgy(options: Readonly<{ acceptCode?: string; showsSignIn?: boolean; signInDelayMs?: number }> = {}) {
  const calls: string[][] = [];
  const running = new Set<number>();
  const servers = new Map<string, { pid: number; screen: string; typed: string; home: string }>();
  let nextPid = 5151;
  const runTmux = async (args: readonly string[], env: NodeJS.ProcessEnv) => {
    calls.push([...args]);
    const socket = args[args.indexOf('-S') + 1] ?? '';
    if (args.includes('new-session')) {
      const pid = nextPid;
      nextPid += 1;
      running.add(pid);
      servers.set(socket, { pid, screen: options.showsSignIn === false ? 'none' : 'menu', typed: '', home: String(env.HOME) });
      return `${pid}\n`;
    }
    const server = servers.get(socket);
    if (!server) return '';
    if (args.includes('capture-pane')) {
      if (server.screen === 'menu') {
        return ' Welcome to the Antigravity CLI. You are currently not signed in.\n Select login method:\n > 1. Google OAuth\n   2. Use a Google Cloud project\n';
      }
      if (server.screen === 'google') {
        return ` Your browser should open automatically. If not:\n ${SIGN_IN_URL}\n If you aren't automatically redirected, paste the authorization code below:\n`;
      }
      return '';
    }
    if (args.includes('send-keys')) {
      if (args.includes('-l')) {
        server.typed += args.at(-1);
      } else if (args.at(-1) === 'Enter' && server.screen === 'menu') {
        server.screen = 'google';
      } else if (args.at(-1) === 'Enter' && server.screen === 'google') {
        if (server.typed === options.acceptCode) {
          const signIn = async () => {
            await mkdir(join(server.home, ...TOKEN.slice(0, -1)), { recursive: true });
            await writeFile(join(server.home, ...TOKEN), 'token');
            server.screen = 'signed-in';
          };
          if (options.signInDelayMs) setTimeout(() => void signIn(), options.signInDelayMs);
          else await signIn();
        }
        server.typed = '';
      }
      return '';
    }
    if (args.includes('kill-server')) running.delete(server.pid);
    if (args.includes('list-panes')) return running.has(server.pid) ? `${server.pid}\n` : '';
    return '';
  };
  const homes = () => [...servers.values()].map((server) => server.home);
  return { calls, runTmux, isRunning: (pid: number) => running.has(pid), running, home: () => homes()[0] ?? '', homes };
}

let accountsDir = '';

beforeEach(async () => {
  accountsDir = join(await mkdtemp(join(tmpdir(), 'agy-logins-')), 'agy-accounts');
});

afterEach(async () => {
  await rm(dirname(accountsDir), { recursive: true, force: true });
});

function reading(email: string | null) {
  return { email, planTier: null, meters: [{ meterId: 'gemini-5h', remainingFraction: 0.5, resetAtMs: 9_000 }] };
}

function create(agy: ReturnType<typeof fakeAgy>, overrides: Partial<Parameters<typeof createAgyAccountLogins>[0]> = {}) {
  const signedIn: string[] = [];
  const readings: unknown[] = [];
  const removed: string[] = [];
  const logins = createAgyAccountLogins({
    accountsDir,
    platform: 'linux',
    resolveAgy: () => AGY,
    identify: async () => null,
    listLogins: async () => [],
    onSignedIn: (accountId, signedInReading) => {
      signedIn.push(accountId);
      readings.push(signedInReading);
    },
    onRemoved: (accountId) => removed.push(accountId),
    runTmux: agy.runTmux,
    isRunning: agy.isRunning,
    pollMs: 5,
    stepBudgetMs: 2_000,
    quitGraceMs: 50,
    ...overrides,
  });
  return { logins, signedIn, readings, removed };
}

async function signInWith(logins: ReturnType<typeof create>['logins']) {
  const started = await logins.start();
  if (!started.ok) throw new Error('not started');
  return await logins.submit(started.loginId, '4/0Abc-123');
}

const folders = async () => (await readdir(accountsDir).catch(() => [] as string[])).sort();

describe('createAgyAccountLogins', () => {
  it('opens Google sign-in for a new login, which the machine does not list before it has signed in', async () => {
    await mkdir(join(accountsDir, 'b'), { recursive: true });
    const agy = fakeAgy();
    const { logins } = create(agy);

    const started = await logins.start();

    expect(started).toEqual({ ok: true, loginId: expect.any(String), accountId: 'a', url: SIGN_IN_URL });
    // A pending login starts with a dot, which no login name can.
    expect(await folders()).toEqual(['.adding-a', 'b']);
    expect(agy.home()).toBe(join(accountsDir, '.adding-a'));
    expect(agy.calls.filter((args) => args.includes('send-keys'))).toHaveLength(1);
    await logins.dispose();
  });

  it('signs in with the code Google showed, or the address it came back to, and joins the list', async () => {
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins, signedIn } = create(agy);
    const started = await logins.start();
    if (!started.ok) throw new Error('not started');

    const result = await logins.submit(started.loginId, 'https://antigravity.google/oauth-callback?code=4%2F0Abc-123&state=s1');

    expect(result).toEqual({ ok: true, accountId: 'a' });
    expect(agy.calls).toContainEqual(expect.arrayContaining(['send-keys', '-l', '--', '4/0Abc-123']));
    expect(signedIn).toEqual(['a']);
    expect(await folders()).toEqual(['a']);
    expect((await stat(join(accountsDir, 'a', ...TOKEN))).isFile()).toBe(true);
    expect(agy.running.size).toBe(0);
    await expect(logins.submit(started.loginId, '4/0Abc-123')).resolves.toEqual({ ok: false, errorCode: 'login_not_found' });
  });

  it('gives up on a code agy does not sign in with, and leaves nothing behind', async () => {
    const agy = fakeAgy({ acceptCode: 'right-code' });
    const { logins, signedIn } = create(agy);
    const started = await logins.start();
    if (!started.ok) throw new Error('not started');

    await expect(logins.submit(started.loginId, 'wrong-code')).resolves.toEqual({ ok: false, errorCode: 'code_not_accepted' });
    await expect(logins.submit(started.loginId, 'right-code')).resolves.toEqual({ ok: false, errorCode: 'login_not_found' });
    expect(signedIn).toEqual([]);
    expect(await folders()).toEqual([]);
    expect(agy.running.size).toBe(0);
  });

  it('keeps the sign-in open when the paste holds no code, for another paste', async () => {
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins } = create(agy);
    const started = await logins.start();
    if (!started.ok) throw new Error('not started');

    await expect(logins.submit(started.loginId, 'https://antigravity.google/oauth-callback?state=s1'))
      .resolves.toEqual({ ok: false, errorCode: 'code_unreadable' });
    await expect(logins.submit(started.loginId, '-Hcode')).resolves.toEqual({ ok: false, errorCode: 'code_unreadable' });
    expect(agy.calls.some((args) => args.includes('-l'))).toBe(false);
    await expect(logins.submit(started.loginId, '4/0Abc-123')).resolves.toEqual({ ok: true, accountId: 'a' });
  });

  it('gives two starts at once their own login', async () => {
    const agy = fakeAgy();
    const { logins } = create(agy);

    const [first, second] = await Promise.all([logins.start(), logins.start()]);

    expect([first, second].map((result) => (result.ok ? result.accountId : result.errorCode)).sort()).toEqual(['a', 'b']);
    expect(await folders()).toEqual(['.adding-a', '.adding-b']);
    expect(new Set(agy.homes()).size).toBe(2);
    await logins.dispose();
    expect(await folders()).toEqual([]);
  });

  it('lets a sign-in that is being checked finish before a cancel, and keeps the login', async () => {
    const agy = fakeAgy({ acceptCode: '4/0Abc-123', signInDelayMs: 50 });
    const { logins, signedIn } = create(agy);
    const started = await logins.start();
    if (!started.ok) throw new Error('not started');

    const [submitted] = await Promise.all([
      logins.submit(started.loginId, '4/0Abc-123'),
      new Promise((resolve) => setTimeout(resolve, 10)).then(() => logins.cancel(started.loginId)),
    ]);

    expect(submitted).toEqual({ ok: true, accountId: 'a' });
    expect(signedIn).toEqual(['a']);
    expect(await folders()).toEqual(['a']);
  });

  it('stops agy and removes the login when the person cancels', async () => {
    const agy = fakeAgy();
    const { logins } = create(agy);
    const started = await logins.start();
    if (!started.ok) throw new Error('not started');

    await logins.cancel(started.loginId);

    expect(await folders()).toEqual([]);
    expect(agy.running.size).toBe(0);
  });

  it('adds no login where agy cannot keep it apart, or where agy is missing', async () => {
    const agy = fakeAgy();
    await expect(create(agy, { platform: 'darwin' }).logins.start()).resolves.toEqual({ ok: false, errorCode: 'unsupported_platform' });
    await expect(create(agy, { resolveAgy: () => null }).logins.start()).resolves.toEqual({ ok: false, errorCode: 'agy_not_installed' });
    expect(agy.calls).toEqual([]);
    expect(await folders()).toEqual([]);
  });

  it('stops when agy shows no Google sign-in', async () => {
    const agy = fakeAgy({ showsSignIn: false });
    const { logins } = create(agy, { stepBudgetMs: 100 });

    await expect(logins.start()).resolves.toEqual({ ok: false, errorCode: 'login_page_not_shown' });
    expect(await folders()).toEqual([]);
    expect(agy.running.size).toBe(0);
  });

  it('clears a login a stopped daemon left half-added, keeps one that signed in, and ends an attempt nobody finishes', async () => {
    await mkdir(join(accountsDir, '.adding-q'), { recursive: true });
    await mkdir(join(accountsDir, '.adding-r', ...TOKEN.slice(0, -1)), { recursive: true });
    await writeFile(join(accountsDir, '.adding-r', ...TOKEN), 'token');
    const agy = fakeAgy();
    const { logins } = create(agy, { lifetimeMs: 100 });

    await logins.start();
    expect(await folders()).toEqual(['.adding-a', '.adding-r']);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await folders()).toEqual(['.adding-r']);
    expect(agy.running.size).toBe(0);
  });
});

describe('one Google account, one login', () => {
  it('signs an added login in again in place when the same Google account signs in, instead of listing it twice', async () => {
    await mkdir(join(accountsDir, 'a'), { recursive: true });
    await writeFile(join(accountsDir, 'a', 'expired-sign-in'), 'old');
    const shown = reading('Same@Example.com');
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins, signedIn, readings } = create(agy, {
      listLogins: async () => [{ accountId: 'default', email: 'main@example.com' }, { accountId: 'a', email: 'same@example.com' }],
      identify: async (homeDir) => (homeDir === join(accountsDir, '.adding-b') ? shown : null),
    });

    await expect(signInWith(logins)).resolves.toEqual({ ok: true, accountId: 'a', replaced: true });

    expect(await folders()).toEqual(['a']);
    expect((await stat(join(accountsDir, 'a', ...TOKEN))).isFile()).toBe(true);
    await expect(stat(join(accountsDir, 'a', 'expired-sign-in'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(signedIn).toEqual(['a']);
    expect(readings).toEqual([shown]);
    expect(agy.running.size).toBe(0);
  });

  it('lets a start pick its name only after a replacement is done, so the name it takes is free', async () => {
    await mkdir(join(accountsDir, 'a'), { recursive: true });
    let release!: () => void;
    const placing = new Promise<void>((resolve) => { release = resolve; });
    let listed = 0;
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins } = create(agy, {
      identify: async () => reading('same@example.com'),
      listLogins: async () => {
        listed += 1;
        await placing;
        return [{ accountId: 'a', email: 'same@example.com' }];
      },
    });
    const first = await logins.start();
    if (!first.ok) throw new Error('not started');

    const submitted = logins.submit(first.loginId, '4/0Abc-123');
    while (listed === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = logins.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    await expect(submitted).resolves.toEqual({ ok: true, accountId: 'a', replaced: true });
    // Picked once the first login had replaced `a`: `b` is free again.
    await expect(second).resolves.toMatchObject({ ok: true, accountId: 'b' });
    expect(await folders()).toEqual(['.adding-b', 'a']);
    await logins.dispose();
  });

  it("keeps nothing when the main login's own Google account signs in", async () => {
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins, signedIn } = create(agy, {
      listLogins: async () => [{ accountId: 'default', email: 'main@example.com' }],
      identify: async () => reading('main@example.com'),
    });

    await expect(signInWith(logins)).resolves.toEqual({ ok: false, errorCode: 'account_is_main_login' });

    expect(await folders()).toEqual([]);
    expect(signedIn).toEqual([]);
    expect(agy.running.size).toBe(0);
  });

  it('adds a new Google account, or one agy did not show in time, as a new login', async () => {
    const agy = fakeAgy({ acceptCode: '4/0Abc-123' });
    const { logins, signedIn } = create(agy, {
      listLogins: async () => [{ accountId: 'default', email: 'main@example.com' }],
      identify: async (homeDir) => (homeDir.endsWith('.adding-a') ? reading('new@example.com') : null),
    });

    await expect(signInWith(logins)).resolves.toEqual({ ok: true, accountId: 'a' });
    await expect(signInWith(logins)).resolves.toEqual({ ok: true, accountId: 'b' });
    expect(await folders()).toEqual(['a', 'b']);
    expect(signedIn).toEqual(['a', 'b']);
  });
});

describe('removing a login', () => {
  it('removes an added login, a linked one losing only its link, and never the main login', async () => {
    const outside = join(dirname(accountsDir), 'kept-elsewhere');
    await mkdir(join(outside, ...TOKEN.slice(0, -1)), { recursive: true });
    await writeFile(join(outside, ...TOKEN), 'token');
    await mkdir(join(accountsDir, 'a'), { recursive: true });
    await symlink(outside, join(accountsDir, 'b'));
    const { logins, removed } = create(fakeAgy());

    await expect(logins.remove('a')).resolves.toEqual({ ok: true });
    await expect(logins.remove('b')).resolves.toEqual({ ok: true });
    await expect(logins.remove('default')).resolves.toEqual({ ok: false, errorCode: 'login_not_removable' });
    await expect(logins.remove('../a')).resolves.toEqual({ ok: false, errorCode: 'invalid_parameters' });

    expect(await folders()).toEqual([]);
    expect((await stat(join(outside, ...TOKEN))).isFile()).toBe(true);
    expect(removed).toEqual(['a', 'b']);
  });

  it('clears what a stopped daemon left half-removed', async () => {
    const outside = join(dirname(accountsDir), 'kept-elsewhere');
    await mkdir(outside, { recursive: true });
    await mkdir(join(accountsDir, '.removing-a-1', 'x'), { recursive: true });
    await symlink(outside, join(accountsDir, '.removing-b-2'));
    const { logins } = create(fakeAgy());

    await logins.start();

    expect(await folders()).toEqual(['.adding-a']);
    expect((await stat(outside)).isDirectory()).toBe(true);
    await logins.dispose();
  });
});

describe('readAuthorizationCode', () => {
  it('takes the code alone or from the address, and nothing that could type more into agy', () => {
    expect(readAuthorizationCode('  4/0Abc-123  ')).toBe('4/0Abc-123');
    expect(readAuthorizationCode('https://antigravity.google/oauth-callback?code=4%2F0Abc&state=s')).toBe('4/0Abc');
    expect(readAuthorizationCode('https://antigravity.google/oauth-callback?state=s')).toBeNull();
    expect(readAuthorizationCode('two words')).toBeNull();
    expect(readAuthorizationCode('code\nrm')).toBeNull();
    expect(readAuthorizationCode('-Hcode')).toBeNull();
  });
});

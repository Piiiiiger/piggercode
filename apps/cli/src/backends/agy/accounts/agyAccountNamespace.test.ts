import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agyCredentialDir,
  agyTokenPath,
  createAgyNamespaceSupportCheck,
  isAgyLoginComplete,
  prepareAgyLoginMountPoints,
  wrapAgyLaunchInLoginNamespace,
} from './agyAccountNamespace';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agy-ns-'));
  dirs.push(dir);
  return dir;
}

describe('wrapAgyLaunchInLoginNamespace', () => {
  it('binds only the login files, and passes the login folder and the agy command as arguments, not as script text', () => {
    const wrapped = wrapAgyLaunchInLoginNamespace({
      accountHomeDir: '/logins/b; rm -rf /',
      cli: { command: '/bin/agy', args: ['--conversation=c1', '--prompt-interactive=$(touch x)'] },
    });
    expect(wrapped.command).toBe('unshare');
    const script = wrapped.args[wrapped.args.indexOf('-c') + 1]!;
    expect(script.match(/mount --bind/g)).toHaveLength(2);
    expect(script).toContain('.gemini/antigravity-cli/antigravity-oauth-token');
    expect(script).toContain('.config/antigravity"');
    expect(script).not.toContain('rm -rf');
    expect(script).not.toContain('touch');
    expect(script).toContain('setpriv --ambient-caps=-all --inh-caps=-all -- "$@"');
    // After `sh -c <script> sh`: the login folder, then the command and its arguments untouched.
    expect(wrapped.args.slice(wrapped.args.indexOf('-c') + 2)).toEqual([
      'sh', '/logins/b; rm -rf /', '/bin/agy', '--conversation=c1', '--prompt-interactive=$(touch x)',
    ]);
  });
});

describe('prepareAgyLoginMountPoints', () => {
  it('creates an empty token file where the default login never signed in, and the credential folder', async () => {
    const home = await tempDir();
    await prepareAgyLoginMountPoints(home);
    expect(await readFile(agyTokenPath(home), 'utf8')).toBe('');
    expect((await stat(agyCredentialDir(home))).isDirectory()).toBe(true);
  });

  it('leaves a real token and folder alone', async () => {
    const home = await tempDir();
    await mkdir(join(home, '.gemini', 'antigravity-cli'), { recursive: true });
    await writeFile(agyTokenPath(home), 'real-token');
    await prepareAgyLoginMountPoints(home);
    expect(await readFile(agyTokenPath(home), 'utf8')).toBe('real-token');
  });
});

describe('isAgyLoginComplete', () => {
  it('needs a token with content and the credential folder', async () => {
    const home = await tempDir();
    expect(await isAgyLoginComplete(home)).toBe(false);
    await prepareAgyLoginMountPoints(home);
    expect(await isAgyLoginComplete(home)).toBe(false);
    await writeFile(agyTokenPath(home), 'token');
    expect(await isAgyLoginComplete(home)).toBe(true);
  });
});

describe('createAgyNamespaceSupportCheck', () => {
  it('is supported when the namespace command runs, asked once', async () => {
    let runs = 0;
    const check = createAgyNamespaceSupportCheck({ platform: 'linux', run: async () => { runs += 1; } });
    expect(await check()).toEqual({ ok: true });
    expect(await check()).toEqual({ ok: true });
    expect(runs).toBe(1);
  });

  it('names the cause when the kernel refuses, and says Linux is needed elsewhere', async () => {
    const refused = createAgyNamespaceSupportCheck({
      platform: 'linux',
      run: async () => { throw new Error('unshare: unshare failed: Operation not permitted'); },
    });
    expect(await refused()).toEqual({ ok: false, reason: 'unshare: unshare failed: Operation not permitted' });
    expect(await createAgyNamespaceSupportCheck({ platform: 'darwin' })()).toMatchObject({ ok: false });
  });
});

describe.runIf(process.platform === 'linux' && (() => {
  try {
    execFileSync('unshare', ['--user', '--map-current-user', '--keep-caps', '--mount', 'true']);
    return true;
  } catch {
    return false;
  }
})())('the namespace on this machine', () => {
  it('shows the login\'s token and credential folder to the program, and nothing else changes', async () => {
    const home = await tempDir();
    const login = await tempDir();
    await mkdir(join(login, '.gemini', 'antigravity-cli'), { recursive: true });
    await mkdir(agyCredentialDir(login), { recursive: true });
    await writeFile(agyTokenPath(login), 'login-b-token');
    await writeFile(join(agyCredentialDir(login), 'credential-user-scope'), 'b-scope');
    await prepareAgyLoginMountPoints(home);
    await writeFile(join(home, 'conversation.txt'), 'shared');
    const wrapped = wrapAgyLaunchInLoginNamespace({
      accountHomeDir: login,
      cli: {
        command: 'sh',
        args: ['-c', 'cat "$HOME/.gemini/antigravity-cli/antigravity-oauth-token" "$HOME/.config/antigravity/credential-user-scope" "$HOME/conversation.txt"'],
      },
    });
    const seen = execFileSync(wrapped.command, wrapped.args, { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(seen).toBe('login-b-tokenb-scopeshared');
    // Outside the namespace the real files are as they were.
    expect(await readFile(agyTokenPath(home), 'utf8')).toBe('');
  });
});

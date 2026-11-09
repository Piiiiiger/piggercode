import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, appendFileSync, constants, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureComputerShellFiles, openShellLink } from './shellLink';
import { runSharedFolderShellServe, shellSocketPath } from './shellServe';

/**
 * `ssh <computer>` end to end with the real OpenSSH client and a real `sshd -i`: the server end
 * (`shellServe.ts`) and the computer end (`shellLink.ts`) joined by pipes where the computer's own
 * `ssh <server> shell` would be, and socat as the ProxyCommand where `piggercode … connect` would be.
 */
const SSHD = '/usr/sbin/sshd';
const hasTools = (() => {
  try {
    accessSync(SSHD, constants.X_OK);
  } catch {
    return false;
  }
  const found = (command: string) => spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
  return found('ssh') && found('ssh-keygen') && found('socat');
})();

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function runSsh(configPath: string, label: string, command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-F', configPath, label, command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe.skipIf(!hasTools)('ssh <computer> through a spare shared-folder connection', () => {
  it('runs each command over its own spare with the real ssh and sshd, and stops once consent is withdrawn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pc-shell-e2e-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const serverDir = join(root, 'server');
    const computerDir = join(root, 'computer');
    const label = 'mac';

    const shell = await ensureComputerShellFiles({ shellDir: computerDir, platform: process.platform, sftpServer: null });
    // The test folders sit under a world-writable temp folder, which sshd's StrictModes refuses.
    appendFileSync(shell.configPath, 'StrictModes no\n');

    let consent = true;
    const children: ChildProcess[] = [];
    cleanups.push(() => children.forEach((child) => child.kill('SIGKILL')));
    const served: Array<Promise<number>> = [];
    const links: Array<{ close: () => void }> = [];
    cleanups.push(() => links.forEach((link) => link.close()));

    // What the computer's shares manager does: one spare, and the next one as soon as it is used.
    const openSpare = () => {
      // The computer's `ssh <server> shell` and the server's forced command, joined by two pipes.
      const toServer = new PassThrough();
      const toComputer = new PassThrough();
      served.push(runSharedFolderShellServe({
        label,
        shellDir: serverDir,
        connectCommand: `socat STDIO UNIX-CONNECT:${shellSocketPath(serverDir, label)}`,
        input: toServer,
        output: toComputer,
        reportError: () => undefined,
      }));
      const sshStandIn = (): ChildProcess => Object.assign(new EventEmitter(), {
        stdin: toServer,
        stdout: toComputer,
        stderr: new PassThrough(),
        exitCode: null,
        signalCode: null,
        kill: () => {
          toServer.end();
          return true;
        },
      }) as unknown as ChildProcess;
      links.push(openShellLink({
        server: { user: 'unused', host: 'unused', port: 22 },
        keyPath: 'unused',
        knownHostsPath: 'unused',
        ssh: 'ssh',
        sshd: SSHD,
        user: userInfo().username,
        shell,
        authorizedKeysPath: join(computerDir, 'authorized_keys.server'),
      }, {
        onReady: () => undefined,
        onInUse: () => openSpare(),
        onClosed: () => undefined,
      }, {
        mayServe: async () => consent,
        spawnProcess: (command, args) => {
          if (command !== SSHD) return sshStandIn();
          const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
          children.push(child);
          return child;
        },
      }));
    };
    openSpare();

    // socat, unlike `piggercode … connect`, does not wait for a spare: let the first one listen.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && spawnSync('test', ['-S', shellSocketPath(serverDir, label)]).status !== 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The user's own config, with the alias included at its top, shares connections for every host:
    // the alias must still take a fresh spare (and consent check) for each command.
    const config = join(root, 'user_ssh_config');
    writeFileSync(config, [
      `Include "${join(serverDir, 'ssh_config')}"`,
      'Host *',
      `  ControlMaster auto`,
      // Short enough for a socket path, with the suffix ssh adds while it sets the master up.
      `  ControlPath "${join(root, 'm')}"`,
      '  ControlPersist 60',
      '',
    ].join('\n'));
    cleanups.push(() => {
      spawnSync('ssh', ['-F', config, '-O', 'exit', label], { stdio: 'ignore' });
    });
    const first = await runSsh(config, label, 'echo "hello from $(whoami)"; exit 0');
    expect(first.stderr).toBe('');
    expect(first).toMatchObject({ code: 0, stdout: `hello from ${userInfo().username}\n` });

    const second = await runSsh(config, label, 'printf "%s" "$((6 * 7))"; exit 7');
    expect(second).toMatchObject({ code: 7, stdout: '42' });

    // Remote commands turned off: the next ssh is refused, with nothing run on the computer.
    consent = false;
    const third = await runSsh(config, label, 'echo should-not-run');
    expect(third.code).not.toBe(0);
    expect(third.stdout).toBe('');

    links.forEach((link) => link.close());
    await Promise.all(served);
  }, 60_000);
});

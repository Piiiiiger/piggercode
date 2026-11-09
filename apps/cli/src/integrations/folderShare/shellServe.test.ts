import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSharedFolderShellConnect, runSharedFolderShellServe, shellSocketPath } from './shellServe';

const HOST_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINQKK0TckxnFot3LMp0B+2WElapYHkD6E8fo78SadK/n';
const CLIENT_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAJVPx8qobM6cn2cdoT1VJ30fi/QBW/E9V0nQAWskEj9';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function shellDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pc-shell-'));
  directories.push(dir);
  return join(dir, 'shell');
}

function collect(stream: PassThrough): { text: () => string } {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return { text: () => Buffer.concat(chunks).toString('utf8') };
}

function openSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function serve(dir: string, input: PassThrough, output: PassThrough, errors: string[] = []) {
  return runSharedFolderShellServe({
    label: 'mac',
    shellDir: dir,
    connectCommand: "'/opt/piggercode' 'machine' 'shared-folders' 'connect' 'mac'",
    input,
    output,
    reportError: (message) => errors.push(message),
    ensureClientKey: async (keyDir) => ({ keyPath: join(keyDir, 'id_ed25519'), publicKey: CLIENT_KEY }),
  });
}

describe('the server end of `ssh <computer>`', () => {
  it('pins the computer\'s host key, answers with its client key, and carries the first ssh that connects', async () => {
    const dir = shellDir();
    const input = new PassThrough();
    const output = new PassThrough();
    const fromServer = collect(output);
    const done = serve(dir, input, output);

    input.write(`pigger ${HOST_KEY}\n`);
    await vi.waitFor(() => expect(fromServer.text()).toBe(`${CLIENT_KEY}\n`));
    expect(readFileSync(join(dir, 'mac.known_hosts'), 'utf8')).toBe(`piggercode-shell-mac ${HOST_KEY}\n`);
    const alias = readFileSync(join(dir, 'mac.conf'), 'utf8');
    expect(alias).toContain('Host mac\n');
    expect(alias).toContain('  User pigger\n');
    expect(alias).toContain("  ProxyCommand '/opt/piggercode' 'machine' 'shared-folders' 'connect' 'mac'\n");
    expect(alias).toContain('  StrictHostKeyChecking yes\n');
    // Every ssh takes its own spare, so the computer checks its consent for each command.
    expect(alias).toContain('  ControlMaster no\n');
    expect(alias).toContain('  ControlPath none\n');
    expect(alias).not.toContain('ControlPersist');
    expect(readFileSync(join(dir, 'ssh_config'), 'utf8')).toBe(`Include "${join(dir, '*.conf')}"\n`);

    await vi.waitFor(() => expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(true));
    const ssh = await openSocket(shellSocketPath(dir, 'mac'));
    const toSsh: Buffer[] = [];
    ssh.on('data', (chunk: Buffer) => toSsh.push(chunk));
    // The next `ssh` has to wait for the computer's next spare.
    await vi.waitFor(() => expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(false));

    ssh.write('SSH-2.0-client\r\n');
    input.write('SSH-2.0-computer\r\n');
    await vi.waitFor(() => expect(fromServer.text()).toBe(`${CLIENT_KEY}\nSSH-2.0-client\r\n`));
    await vi.waitFor(() => expect(Buffer.concat(toSsh).toString('utf8')).toBe('SSH-2.0-computer\r\n'));

    ssh.end();
    await expect(done).resolves.toBe(0);
  });

  it('takes its socket back when the computer goes before anyone used it, and keeps a newer spare\'s', async () => {
    const dir = shellDir();
    const older = { input: new PassThrough(), output: new PassThrough() };
    const olderDone = serve(dir, older.input, older.output);
    older.input.write(`pigger ${HOST_KEY}\n`);
    await vi.waitFor(() => expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(true));

    const newer = { input: new PassThrough(), output: new PassThrough() };
    const newerReply = collect(newer.output);
    const newerDone = serve(dir, newer.input, newer.output);
    newer.input.write(`pigger ${HOST_KEY}\n`);
    await vi.waitFor(() => expect(newerReply.text()).toBe(`${CLIENT_KEY}\n`));
    // Let the newer spare's listen take the path.
    await new Promise((resolve) => setTimeout(resolve, 50));

    older.input.end();
    await expect(olderDone).resolves.toBe(0);
    expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(true);

    newer.input.end();
    await expect(newerDone).resolves.toBe(0);
    expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(false);
  });

  it('refuses a connection that does not announce a shell', async () => {
    const dir = shellDir();
    const input = new PassThrough();
    const errors: string[] = [];
    const done = serve(dir, input, new PassThrough(), errors);
    input.write('mount code\n');
    await expect(done).resolves.toBe(2);
    expect(errors.join('\n')).toContain('did not announce its shell');
    expect(existsSync(shellSocketPath(dir, 'mac'))).toBe(false);
  });
});

describe('`piggercode machine shared-folders connect <computer>`', () => {
  it('joins ssh to the computer\'s spare connection', async () => {
    const dir = shellDir();
    mkdirSync(dir, { recursive: true });
    const received: Buffer[] = [];
    const spare = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => received.push(chunk));
      socket.write('SSH-2.0-computer\r\n');
      socket.on('end', () => socket.end());
    });
    await new Promise<void>((resolve) => spare.listen(shellSocketPath(dir, 'mac'), () => resolve()));

    const input = new PassThrough();
    const output = new PassThrough();
    const fromComputer = collect(output);
    const done = runSharedFolderShellConnect({ label: 'mac', shellDir: dir, input, output, reportError: () => undefined });
    input.write('SSH-2.0-client\r\n');
    await vi.waitFor(() => expect(fromComputer.text()).toBe('SSH-2.0-computer\r\n'));
    await vi.waitFor(() => expect(Buffer.concat(received).toString('utf8')).toBe('SSH-2.0-client\r\n'));
    input.end();
    await expect(done).resolves.toBe(0);
    spare.close();
  });

  it('waits a moment for a spare, then says the computer is not connected', async () => {
    const errors: string[] = [];
    const code = await runSharedFolderShellConnect({
      label: 'mac',
      shellDir: shellDir(),
      input: new PassThrough(),
      output: new PassThrough(),
      reportError: (message) => errors.push(message),
      waitMs: 120,
      retryEveryMs: 20,
    });
    expect(code).toBe(255);
    expect(errors.join('\n')).toContain('mac is not connected');
  });
});

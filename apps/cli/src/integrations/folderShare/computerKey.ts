import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * This computer's key for shared folders, `<dir>/id_ed25519`: made once with ssh-keygen, then accepted
 * by each server the computer shares folders with, for mounting them and nothing else.
 */
export async function ensureSharedFoldersKey(dir: string): Promise<Readonly<{ keyPath: string; publicKey: string }>> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keyPath = join(dir, 'id_ed25519');
  let publicKeyText = await readPublicKey(`${keyPath}.pub`);
  if (publicKeyText === null) {
    await runKeygen(keyPath);
    publicKeyText = await readPublicKey(`${keyPath}.pub`);
  }
  const [type, data] = (publicKeyText ?? '').trim().split(/\s+/);
  if (type !== 'ssh-ed25519' || !data) throw new Error('Could not create the key for shared folders');
  return { keyPath, publicKey: `${type} ${data}` };
}

async function readPublicKey(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function runKeygen(keyPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'piggercode-shared-folders', '-f', keyPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ssh-keygen failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { parseCodexRolloutFilename } from '@/backends/codex/utils/codexSessionFiles';

export type HeldCodexThread = Readonly<{
  threadId: string;
  /** The conversation's rollout file, when the process holds it open. */
  rolloutPath: string | null;
}>;

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Codex conversations a running `codex` writes, read from the files it holds open: the rollout
 * (`rollout-<time>-<thread id>.jsonl`) and the writer lock (`thread-writer-locks/<thread id>.lock`).
 * Codex has no flag that names a new conversation up front, and several terminals can start in one
 * folder at once, so the process itself is the only exact answer. Looks at the process and its
 * children (an npm-installed `codex` is a Node wrapper around the real binary). Linux reads /proc,
 * macOS asks lsof; elsewhere, and for a process that is gone, it finds nothing.
 */
export async function readCodexThreadsHeldByProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<HeldCodexThread[]> {
  if (platform === 'linux') return collectHeldCodexThreads(await readLinuxOpenFiles(pid));
  if (platform === 'darwin') return collectHeldCodexThreads(await readDarwinOpenFiles(pid));
  return [];
}

export function collectHeldCodexThreads(paths: readonly string[]): HeldCodexThread[] {
  const threads = new Map<string, string | null>();
  for (const path of paths) {
    const rollout = parseCodexRolloutFilename(path);
    if (rollout) {
      const threadId = rollout.threadId ?? (THREAD_ID.test(rollout.sessionId) ? rollout.sessionId : null);
      if (!threadId) continue;
      // A continuation file (with a turn id) does not start the conversation; prefer the one that does.
      const known = threads.get(threadId);
      if (!known || (!rollout.turnId && parseCodexRolloutFilename(known)?.turnId)) threads.set(threadId, path);
      continue;
    }
    const name = basename(path);
    if (basename(dirname(path)) !== 'thread-writer-locks' || !name.endsWith('.lock')) continue;
    const threadId = name.slice(0, -'.lock'.length);
    if (THREAD_ID.test(threadId) && !threads.has(threadId)) threads.set(threadId, null);
  }
  return [...threads].map(([threadId, rolloutPath]) => ({ threadId, rolloutPath }));
}

async function readLinuxOpenFiles(pid: number): Promise<string[]> {
  const children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => '');
  const pids = [pid, ...children.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger)];
  const perProcess = await Promise.all(pids.map(async (processId) => {
    const fdDir = `/proc/${processId}/fd`;
    const fds = await readdir(fdDir).catch(() => [] as string[]);
    const targets = await Promise.all(fds.map((fd) => readlink(`${fdDir}/${fd}`).catch(() => '')));
    return targets.filter((target) => target.startsWith('/'));
  }));
  return perProcess.flat();
}

async function readDarwinOpenFiles(pid: number): Promise<string[]> {
  const children = await run('/usr/bin/pgrep', ['-P', String(pid)]);
  const pids = [String(pid), ...children.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line))];
  // `-F n` prints one `n<path>` line per open file; lsof exits 1 when it finds none.
  const listing = await run('/usr/sbin/lsof', ['-w', '-a', '-p', pids.join(','), '-F', 'n']);
  return listing.split('\n').filter((line) => line.startsWith('n/')).map((line) => line.slice(1));
}

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => {
      resolve(typeof stdout === 'string' ? stdout : '');
    });
  });
}

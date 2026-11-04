import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A server's record of the computers that share folders with it: one line per computer in the user's
 * `~/.ssh/authorized_keys`. The line is the authority. Its forced command lets the computer's key do one
 * thing, run `piggercode machine shared-folders serve --label <label>`, which mounts that computer's
 * folders under `~/local/<label>`; its comment names the computer, so the same lines are the list of
 * computers that agents on this server are told about.
 */

const COMMENT_PREFIX = 'piggercode-shared-folders:';
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** The label argument of the forced command, plain or single-quoted (`buildPosixShellCommand`). */
const LABEL_IN_COMMAND = /'?--label'?\s+'?([a-z0-9][a-z0-9-]*)/;
const LABEL_MAX_LENGTH = 40;

export type AcceptedComputer = Readonly<{ machineId: string; label: string }>;

/**
 * The key exactly as a computer sends it: `ssh-ed25519 <base64>` and nothing else, so that the text
 * written into authorized_keys cannot carry options, a comment of its own or another line.
 */
export function parseComputerPublicKey(text: string): string | null {
  const trimmed = text.trim();
  const match = /^ssh-ed25519 ([A-Za-z0-9+/]+={0,2})$/.exec(trimmed);
  if (!match) return null;
  const encoded = match[1]!;
  const blob = Buffer.from(encoded, 'base64');
  if (blob.toString('base64') !== encoded) return null;
  // The wire form: the string "ssh-ed25519", then the 32-byte key.
  if (blob.length !== 51 || blob.readUInt32BE(0) !== 11 || blob.readUInt32BE(15) !== 32) return null;
  if (blob.subarray(4, 15).toString('latin1') !== 'ssh-ed25519') return null;
  return trimmed;
}

export function listAcceptedComputers(authorizedKeys: string): AcceptedComputer[] {
  const computers: AcceptedComputer[] = [];
  for (const line of authorizedKeys.split('\n')) {
    const computer = parseAcceptedComputerLine(line);
    if (computer) computers.push(computer);
  }
  return computers;
}

export async function readAcceptedComputers(homeDir: string): Promise<AcceptedComputer[]> {
  return listAcceptedComputers(await readAuthorizedKeys(join(homeDir, '.ssh', 'authorized_keys')));
}

/**
 * Authorizes a computer's key for its shared folders, replacing the line an earlier key of the same
 * computer had. The computer keeps its folder name once it has one; a new computer's folder is named
 * after it, made unique among the others. Calls are serialized, so two computers accepted at once
 * cannot drop each other's line.
 */
export async function acceptComputerKey(params: Readonly<{
  homeDir: string;
  machineId: string;
  computerName: string;
  publicKey: string;
  /** The forced command for the computer's folder (`label`); it may not contain `"`, `\` or a line break. */
  serveCommand: (label: string) => string;
}>): Promise<Readonly<{ label: string }>> {
  const run = acceptQueue.then(() => acceptNow(params));
  acceptQueue = run.then(() => undefined, () => undefined);
  return await run;
}

let acceptQueue: Promise<void> = Promise.resolve();

async function acceptNow(params: Parameters<typeof acceptComputerKey>[0]): Promise<Readonly<{ label: string }>> {
  if (!MACHINE_ID_PATTERN.test(params.machineId)) throw new Error('Invalid machine id');
  const publicKey = parseComputerPublicKey(params.publicKey);
  if (!publicKey) throw new Error('Invalid public key: expected one ssh-ed25519 key');

  const sshDir = join(params.homeDir, '.ssh');
  const file = join(sshDir, 'authorized_keys');
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  const current = await readAuthorizedKeys(file);

  const label = chooseLabel({
    computerName: params.computerName,
    machineId: params.machineId,
    accepted: listAcceptedComputers(current),
  });
  const command = params.serveCommand(label);
  if (/["\\\r\n]/.test(command)) throw new Error('The shared-folders command cannot be written into authorized_keys');

  const kept = current.split('\n').filter((line) => parseAcceptedComputerLine(line)?.machineId !== params.machineId);
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
  kept.push(`restrict,command="${command}" ${publicKey} ${COMMENT_PREFIX}${params.machineId}`);

  const temporary = `${file}.piggercode-${process.pid}.tmp`;
  await writeFile(temporary, `${kept.join('\n')}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
  return { label };
}

async function readAuthorizedKeys(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function parseAcceptedComputerLine(line: string): AcceptedComputer | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const comment = trimmed.slice(trimmed.lastIndexOf(' ') + 1);
  if (!comment.startsWith(COMMENT_PREFIX)) return null;
  const machineId = comment.slice(COMMENT_PREFIX.length);
  const label = LABEL_IN_COMMAND.exec(trimmed)?.[1];
  if (!MACHINE_ID_PATTERN.test(machineId) || !label) return null;
  return { machineId, label };
}

function chooseLabel(params: Readonly<{
  computerName: string;
  machineId: string;
  accepted: readonly AcceptedComputer[];
}>): string {
  const own = params.accepted.find((computer) => computer.machineId === params.machineId);
  if (own) return own.label;
  const taken = new Set(params.accepted.map((computer) => computer.label));
  const base = labelFromName(params.computerName);
  if (!taken.has(base)) return base;
  const suffix = params.machineId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'x';
  let candidate = `${base}-${suffix}`;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${suffix}${n}`;
  return candidate;
}

/** A folder name from the computer's name: lowercase letters, digits and single dashes. */
function labelFromName(name: string): string {
  const label = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LABEL_MAX_LENGTH)
    .replace(/-+$/g, '');
  return label || 'computer';
}

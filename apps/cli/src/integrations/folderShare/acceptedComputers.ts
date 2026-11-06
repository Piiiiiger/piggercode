import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serverPlaceProblem } from './serverPlace';
import { isWithin, listSharedFolderMounts, type SharedFolderMount } from './sharedFolderMounts';
import { parseServerLocation } from './serverLocation';

/**
 * A server's record of the computers that share folders with it: one line per computer in the user's
 * `~/.ssh/authorized_keys`. The line is the authority. Its forced command lets the computer's key do one
 * thing, run `piggercode machine shared-folders serve --label <label> --place <place>…`, which mounts that
 * computer's folders at the places the server agreed to (or under `~/local/<label>` for a computer
 * before places); its comment names the computer, so the same lines are the list of computers that
 * agents on this server are told about.
 */

const COMMENT_PREFIX = 'piggercode-shared-folders:';
const MACHINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
/** The label argument of the forced command, plain or single-quoted (`buildPosixShellCommand`). */
const LABEL_IN_COMMAND = /'?--label'?\s+'?([a-z0-9][a-z0-9-]*)/;
/** `--place '<place>'` in the forced command (a place holds no quote: `serverLocation.ts`). */
const PLACE_IN_COMMAND = /'?--place'?\s+(?:'([^']*)'|([^\s'"]+))/g;
const LABEL_MAX_LENGTH = 40;

export type AcceptedComputer = Readonly<{
  machineId: string;
  label: string;
  /** The places in this home it may mount its folders at (its forced command's `--place`s). */
  places: readonly string[];
}>;

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
  /**
   * The places in this home the computer may mount its folders at, the whole set (the app shares or
   * moves a folder); absent from a computer before places, which keeps what it had.
   */
  places?: readonly string[];
  /** The forced command for the computer (`label`) and its places; it may not contain `"`, `\` or a line break. */
  serveCommand: (label: string, places: readonly string[]) => string;
  /** This server's mount table; the OS's by default. */
  mountinfo?: string;
}>): Promise<Readonly<{ label: string; places: readonly string[] }>> {
  const run = acceptQueue.then(() => acceptNow(params));
  acceptQueue = run.then(() => undefined, () => undefined);
  return await run;
}

let acceptQueue: Promise<void> = Promise.resolve();

async function acceptNow(params: Parameters<typeof acceptComputerKey>[0]): Promise<Readonly<{ label: string; places: readonly string[] }>> {
  if (!MACHINE_ID_PATTERN.test(params.machineId)) throw new Error('Invalid machine id');
  const publicKey = parseComputerPublicKey(params.publicKey);
  if (!publicKey) throw new Error('Invalid public key: expected one ssh-ed25519 key');

  const sshDir = join(params.homeDir, '.ssh');
  const file = join(sshDir, 'authorized_keys');
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  const current = await readAuthorizedKeys(file);

  const accepted = listAcceptedComputers(current);
  const label = chooseLabel({
    computerName: params.computerName,
    machineId: params.machineId,
    accepted,
  });
  const own = accepted.find((computer) => computer.machineId === params.machineId)?.places ?? [];
  const places = params.places === undefined
    ? own
    : checkPlaces({
      homeDir: params.homeDir,
      requested: params.places,
      own,
      others: accepted.filter((computer) => computer.machineId !== params.machineId),
      mounts: listSharedFolderMounts(params.homeDir, params.mountinfo),
    });
  const command = params.serveCommand(label, places);
  if (/["\\\r\n]/.test(command)) throw new Error('The shared-folders command cannot be written into authorized_keys');

  const kept = current.split('\n').filter((line) => parseAcceptedComputerLine(line)?.machineId !== params.machineId);
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
  kept.push(`restrict,command="${command}" ${publicKey} ${COMMENT_PREFIX}${params.machineId}`);

  const temporary = `${file}.piggercode-${process.pid}.tmp`;
  await writeFile(temporary, `${kept.join('\n')}\n`, { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600);
  return { label, places };
}

/**
 * The places a computer asks for, as this server agrees to them: each one a place by the rule
 * (`serverLocation.ts`), apart from its others and from every place of another computer, and then a new
 * one free of symbolic links on disk (`serverPlace.ts`). Never on disk through a shared folder mounted
 * on the way (a dropped connection's hangs whatever touches it; `serve` checks the place again once it
 * has ended this computer's). Throws with the reason for the first that is not.
 */
function checkPlaces(params: Readonly<{
  homeDir: string;
  requested: readonly string[];
  own: readonly string[];
  others: readonly AcceptedComputer[];
  mounts: readonly SharedFolderMount[];
}>): string[] {
  const places: string[] = [];
  for (const raw of params.requested) {
    const location = parseServerLocation(raw);
    if (!location.ok) throw new Error(location.error);
    if (places.some((place) => placesOverlap(place, location.at))) throw new Error(`~/${location.at} overlaps another place of this computer.`);
    if (params.others.some((computer) => computer.places.some((place) => placesOverlap(place, location.at)))) {
      throw new Error(`~/${location.at} on this machine is where another computer's folder is shared.`);
    }
    places.push(location.at);
  }
  for (const at of places) {
    const mountPoint = join(params.homeDir, at);
    if (params.own.includes(at) || params.mounts.some((mount) => isWithin(mountPoint, mount.path))) continue;
    const problem = serverPlaceProblem(params.homeDir, at);
    if (problem) throw new Error(`${problem}, so no folder is shared there.`);
  }
  return places;
}

function placesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
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
  // A place it cannot read is none: `serve` mounts only where this parser reads one.
  const places = [...trimmed.matchAll(PLACE_IN_COMMAND)].flatMap((match) => {
    const location = parseServerLocation(match[1] ?? match[2] ?? '');
    return location.ok ? [location.at] : [];
  });
  return { machineId, label, places };
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

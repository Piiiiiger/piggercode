import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { listAcceptedComputers } from './acceptedComputers';
import {
  isWithin,
  listSharedFolderMounts,
  readMountinfoIfAny,
  realHomeOf,
  startMountProbe,
  type MountProbe,
} from './sharedFolderMounts';

/** How long one answer of a shared folder stands before the folder is asked again. */
const SHARED_FOLDER_ANSWER_FRESH_MS = 10_000;

export type SharedFolderPathCheck = Readonly<{ inSharedFolder: boolean; problem: string | null }>;

/**
 * This home's authorized_keys, where the server records the places computers may mount their folders at
 * (`acceptedComputers.ts`); none where there is no such file to read.
 */
function readAuthorizedKeysIfAny(homeDir: string): string {
  try {
    return readFileSync(join(homeDir, '.ssh', 'authorized_keys'), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Checks a path before this process starts anything there or touches it. A folder another computer shares
 * here answers only while that computer's connection is up; anything started in it while the connection
 * hangs (a process's working directory, a stat, a realpath) waits until the connection is ended, and in a
 * daemon that holds every other request too. So a path in a shared folder is used only while the folder
 * answers. A path elsewhere costs one read of the mount table and of authorized_keys. One probe at a time
 * per folder: an answer stands for 10 s, a missing one only until its probe is gone, and while a probe is held by
 * a dead connection no other is started.
 *
 * A place a computer may mount a folder at (its authorized_keys line) counts as that folder while nothing is
 * mounted there: the computer is not connected. Using it then would put a session in an empty folder of this
 * server instead of the computer's, and whatever it made there would keep the folder from mounting again
 * (`serve` mounts only over an empty place).
 */
export function createSharedFolderHealth(deps: Readonly<{
  homeDir?: () => string;
  readMountinfo?: () => string;
  readAuthorizedKeys?: (homeDir: string) => string;
  probe?: (path: string) => MountProbe;
  now?: () => number;
}> = {}) {
  const homeDirOf = deps.homeDir ?? homedir;
  const readTable = deps.readMountinfo ?? readMountinfoIfAny;
  const readKeys = deps.readAuthorizedKeys ?? readAuthorizedKeysIfAny;
  const probe = deps.probe ?? startMountProbe;
  const now = deps.now ?? Date.now;
  const asked = new Map<string, { at: number; answers: Promise<boolean>; probeRunning: boolean; answered: boolean | null }>();

  /**
   * `path` as the home names it: a home reached through a symbolic link (/home/u → /srv/homes/u) has its shared
   * folders listed under the home as named, so a path spelled through the real home is read as that one.
   */
  const asNamedUnderHome = (homeDir: string, path: string) => {
    const realHome = realHomeOf(homeDir);
    return realHome !== homeDir && isWithin(path, realHome) ? join(homeDir, relative(realHome, path)) : path;
  };

  /** The mounted shared folder that holds `path` (the innermost), if any. */
  const mountOf = (homeDir: string, path: string) => listSharedFolderMounts(homeDir, readTable())
    .filter((candidate) => isWithin(path, candidate.path))
    .sort((left, right) => right.path.length - left.path.length)[0];

  /** The place a computer may mount a folder at that holds `path`, as the home names it, if any. */
  const placeOf = (homeDir: string, path: string) => {
    for (const computer of listAcceptedComputers(readKeys(homeDir))) {
      for (const place of computer.places) {
        const placePath = join(homeDir, place);
        if (isWithin(path, placePath)) return { label: computer.label, path: placePath };
      }
    }
    return null;
  };

  return {
    /**
     * Whether `path` lies in a shared folder, mounted or not: reads of the mount table and authorized_keys,
     * nothing touches the folder. The path is taken as written (`..` and `.` resolved, no links followed:
     * that would touch the folder).
     */
    covers(path: string): boolean {
      const homeDir = homeDirOf();
      const normalized = asNamedUnderHome(homeDir, resolve(path));
      return mountOf(homeDir, normalized) !== undefined || placeOf(homeDir, normalized) !== null;
    },
    async check(path: string): Promise<SharedFolderPathCheck> {
      const homeDir = homeDirOf();
      const normalized = asNamedUnderHome(homeDir, resolve(path));
      const shown = (folder: string) => isWithin(folder, homeDir) ? `~/${relative(homeDir, folder)}` : folder;
      const mount = mountOf(homeDir, normalized);
      if (!mount) {
        const place = placeOf(homeDir, normalized);
        if (!place) return { inSharedFolder: false, problem: null };
        return {
          inSharedFolder: true,
          problem: `${shown(place.path)} is a folder the computer ${place.label} shares here, and that computer is not connected now (asleep or offline), so the folder is not here. Try again once it is back.`,
        };
      }
      const key = `${mount.device} ${mount.path}`;
      let entry = asked.get(key);
      // A folder that did not answer is asked again as soon as its probe is gone: a persistent mount keeps its
      // device when the computer connects again, so the device alone does not show that it came back.
      if (!entry || (!entry.probeRunning && (entry.answered === false || now() - entry.at > SHARED_FOLDER_ANSWER_FRESH_MS))) {
        const started = probe(mount.path);
        const fresh = { at: now(), answers: started.answers, probeRunning: true, answered: null as boolean | null };
        void started.answers.then((answered) => {
          fresh.answered = answered;
        });
        void started.exited.then(() => {
          fresh.probeRunning = false;
        });
        asked.set(key, fresh);
        entry = fresh;
      }
      if (await entry.answers) return { inSharedFolder: true, problem: null };
      return {
        inSharedFolder: true,
        problem: `${shown(mount.path)} is a folder the computer ${mount.label} shares here, and that computer is not answering now (asleep or offline). Try again once it is back.`,
      };
    },
  };
}

const sharedFolderHealth = createSharedFolderHealth();

/**
 * `createSharedFolderHealth()` for this process. Callers ask `isInSharedFolder` first and await
 * `checkSharedFolderPath` only for a path in a shared folder, so everything else starts as before.
 */
export const isInSharedFolder = (path: string): boolean => sharedFolderHealth.covers(path);
export const checkSharedFolderPath = (path: string): Promise<SharedFolderPathCheck> => sharedFolderHealth.check(path);

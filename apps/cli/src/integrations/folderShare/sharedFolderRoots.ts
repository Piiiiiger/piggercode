import { join, relative, sep } from 'node:path';

import type { MachineFileBrowserRoot } from '@piggercode/protocol';

import { readAcceptedComputers } from './acceptedComputers';
import { listSharedFolderMounts } from './serve';

/**
 * The folders of the user's computers mounted on this server right now, as file-browser roots, so a
 * folder picker can offer them directly instead of walking `~/local/<computer>/`. From this server's
 * own mounts (`listSharedFolderMounts`) and its accepted computers (`acceptedComputers.ts`), which say
 * whose folder each one is. A machine without such mounts (or without /proc, where they are read
 * from) has none.
 */
export async function listSharedFolderRoots(params: Readonly<{
  homeDir: string;
  /** Test seam: the mount table, instead of `/proc/self/mountinfo`. */
  mountinfo?: string;
}>): Promise<MachineFileBrowserRoot[]> {
  let mounts: string[];
  try {
    mounts = params.mountinfo === undefined
      ? listSharedFolderMounts(params.homeDir)
      : listSharedFolderMounts(params.homeDir, params.mountinfo);
  } catch {
    return [];
  }
  if (mounts.length === 0) return [];
  const computers = await readAcceptedComputers(params.homeDir).catch(() => []);
  const localRoot = join(params.homeDir, 'local');
  return mounts.flatMap((path) => {
    const [label, ...rest] = relative(localRoot, path).split(sep);
    const folder = rest.join('/');
    if (!label || !folder) return [];
    const computer = computers.find((candidate) => candidate.label === label);
    return [{
      id: `shared-folder:${path}`,
      label: `${label}/${folder}`,
      path,
      sharedFolder: { folder, ...(computer ? { computerMachineId: computer.machineId } : {}) },
    }];
  });
}

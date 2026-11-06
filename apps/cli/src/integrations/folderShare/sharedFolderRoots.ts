import { relative, sep } from 'node:path';

import type { MachineFileBrowserRoot } from '@piggercode/protocol';

import { readAcceptedComputers } from './acceptedComputers';
import { listSharedFolderMounts } from './sharedFolderMounts';

/**
 * The folders of the user's computers mounted on this server right now, as file-browser roots named
 * by where they are (`~/code`), so the app can offer and mark them. From this server's own mounts
 * (`listSharedFolderMounts`, which says whose each one is) and its accepted computers
 * (`acceptedComputers.ts`, which says which machine a label is). A machine without such mounts (or
 * without /proc, where they are read from) has none.
 */
export async function listSharedFolderRoots(params: Readonly<{
  homeDir: string;
  /** Test seam: the mount table, instead of `/proc/self/mountinfo`. */
  mountinfo?: string;
}>): Promise<MachineFileBrowserRoot[]> {
  let mounts: ReturnType<typeof listSharedFolderMounts>;
  try {
    mounts = params.mountinfo === undefined
      ? listSharedFolderMounts(params.homeDir)
      : listSharedFolderMounts(params.homeDir, params.mountinfo);
  } catch {
    return [];
  }
  if (mounts.length === 0) return [];
  const computers = await readAcceptedComputers(params.homeDir).catch(() => []);
  return mounts.map((mount) => {
    const computer = computers.find((candidate) => candidate.label === mount.label);
    return {
      id: `shared-folder:${mount.path}`,
      label: `~/${relative(params.homeDir, mount.path).split(sep).join('/')}`,
      path: mount.path,
      sharedFolder: {
        folder: mount.folder,
        computerLabel: mount.label,
        ...(computer ? { computerMachineId: computer.machineId } : {}),
      },
    };
  });
}

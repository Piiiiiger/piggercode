import { homedir } from 'node:os';

import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { parseSshAddress } from '@/integrations/folderShare/acceptRequest';
import { readAcceptedComputers } from '@/integrations/folderShare/acceptedComputers';
import { listSharedFolderMounts, runSharedFoldersServe } from '@/integrations/folderShare/serve';
import { readSettings, updateSettings } from '@/persistence';

/**
 * `piggercode machine shared-folders …` (shared folders, `folderShare.ts` in the protocol):
 * - `address [<host[:port]> | --clear]`: on a server, the SSH address other machines of the account
 *   reach it at. A server accepts shared folders only once it is set.
 * - `status`: the address, the computers whose folders this machine accepts, what is mounted under
 *   `~/local` now, and the folders this machine shares itself.
 * - `serve --label <label>`: the forced command of a computer's key (`serve.ts`). Not for people, and it
 *   writes nothing to stdout, which is the connection, not even when it fails.
 */
export async function runSharedFoldersSubcommand(args: readonly string[], json: boolean): Promise<void> {
  const [action, ...rest] = args;
  if (action === 'serve') {
    await serve(rest);
    return;
  }
  if (action === 'address') {
    await address(rest, json);
    return;
  }
  if (action === 'status' || action === undefined) {
    await status(json);
    return;
  }
  throw new Error('Usage: piggercode machine shared-folders address [<host[:port]> | --clear] | status');
}

async function serve(args: readonly string[]): Promise<void> {
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1] ?? '' : '';
  try {
    process.exitCode = await runSharedFoldersServe({
      label,
      originalCommand: process.env.SSH_ORIGINAL_COMMAND,
      homeDir: homedir(),
    });
  } catch (error) {
    process.stderr.write(`piggercode shared folders: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function address(args: readonly string[], json: boolean): Promise<void> {
  const value = args.find((arg) => !arg.startsWith('-'));
  if (args.includes('--clear')) {
    await updateSettings((current) => {
      const { sharedFoldersSshAddress: _cleared, ...rest } = current;
      return rest;
    });
  } else if (value !== undefined) {
    if (!parseSshAddress(value)) throw new Error(`Not an SSH address: ${value}. Expected host or host:port.`);
    await updateSettings((current) => ({ ...current, sharedFoldersSshAddress: value.trim() }));
  }
  const current = (await readSettings()).sharedFoldersSshAddress ?? null;
  if (json) {
    await printJsonEnvelope({ ok: true, kind: 'machine_shared_folders', data: { address: current } });
    return;
  }
  console.log(current
    ? `Shared folders: your other machines reach this one at ${current}.`
    : 'Shared folders: no SSH address set, so this machine does not accept shared folders.');
}

async function status(json: boolean): Promise<void> {
  const home = homedir();
  const settings = await readSettings();
  const data = {
    address: settings.sharedFoldersSshAddress ?? null,
    acceptedComputers: await readAcceptedComputers(home),
    mounted: process.platform === 'linux' ? listSharedFolderMounts(home) : [],
    sharedFolders: settings.sharedFolders ?? [],
  };
  if (json) {
    await printJsonEnvelope({ ok: true, kind: 'machine_shared_folders', data });
    return;
  }
  console.log(data.address
    ? `Accepting shared folders at ${data.address}.`
    : 'Not accepting shared folders (no SSH address set).');
  for (const computer of data.acceptedComputers) {
    console.log(`  computer ${computer.machineId}: ~/local/${computer.label}/`);
  }
  for (const mount of data.mounted) console.log(`  mounted: ${mount}`);
  for (const share of data.sharedFolders) console.log(`Sharing ~/${share.folder} with machine ${share.serverMachineId}.`);
}

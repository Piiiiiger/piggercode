import { homedir } from 'node:os';

import {
  MACHINE_COMMAND_DEFAULT_TIMEOUT_MS,
  MACHINE_COMMAND_MAX_TIMEOUT_MS,
  type PromptBlockV1,
} from '@piggercode/protocol';

import { readAcceptedComputers, type AcceptedComputer } from '@/integrations/folderShare/acceptedComputers';
import { logger } from '@/ui/logger';

/**
 * Shared folders, for agents on a server: which of the user's computers have folders mounted here under
 * `~/local`, and that commands for those folders run on the computer they belong to. Present only on a
 * machine that accepts shared folders; the accepted computers are read from where the server keeps them
 * (`acceptedComputers.ts`), so the block follows every computer accepted or removed.
 */
export async function resolveSharedFoldersPromptBlocks(homeDir: string = homedir()): Promise<PromptBlockV1[]> {
  let computers: AcceptedComputer[];
  try {
    computers = await readAcceptedComputers(homeDir);
  } catch (error) {
    logger.debug('[SHARED FOLDERS] Could not read the accepted computers for the prompt', { error: String(error) });
    return [];
  }
  if (computers.length === 0) return [];
  return [{ id: 'session.shared_folders', scope: 'session', text: buildSharedFoldersPromptText(computers) }];
}

export function buildSharedFoldersPromptText(computers: readonly AcceptedComputer[]): string {
  return [
    '# Folders from the user’s computers',
    '',
    'Folders of the user’s own computers can be mounted on this machine under ~/local: ~/local/<computer>/X is the folder ~/X on that computer.',
    ...computers.map((computer) => `- ~/local/${computer.label}/ is computer machine id ${computer.machineId}`),
    '',
    'When your working directory is inside one of these folders:',
    '- Read and edit its files here as usual. They are that computer’s files, and your changes land there.',
    '- Run builds, tests, git, package managers and other commands on that computer, not here: call the PiggerCode tool '
      + 'machine_command_run with its machine id and cwd ~/X for ~/local/<computer>/X. '
      + `A call stops after ${MACHINE_COMMAND_DEFAULT_TIMEOUT_MS / 1000} s unless you pass timeoutMs (at most ${MACHINE_COMMAND_MAX_TIMEOUT_MS}); `
      + 'start longer jobs in the background with their output in a log file, and keep output short (pipe it through tail).',
    '- Commands there run in a plain non-interactive shell, so settings that live only in ~/.bashrc (nvm, aliases) are missing; use bash -lc when a tool is not found.',
    '- Every file access crosses the network: search and inspect with machine_command_run (rg, git status, git diff) rather than scanning the folder from here.',
    '- If the folder is missing or empty, or the tool says remote commands are off or the computer is offline, stop and tell the user. Do not fall back to this machine’s own tools or files.',
  ].join('\n');
}

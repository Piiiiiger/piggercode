import { printResult } from '../utils/cli/cli.mjs';
import { openWorkspaceInEditor, writeStackCodeWorkspace } from '../utils/stack/editor_workspace.mjs';

function resolveWorkspaceCommandOptions({ flags }) {
  return {
    includeStackDir: !flags.has('--no-stack-dir'),
    includeAllComponents: flags.has('--include-all-components'),
    includeCliHome: flags.has('--include-cli-home'),
  };
}

async function runStackEditorWorkspaceCommand({
  rootDir,
  stackName,
  json,
  editor,
  includeStackDir,
  includeAllComponents,
  includeCliHome,
}) {
  const ws = await writeStackCodeWorkspace({
    rootDir,
    stackName,
    includeStackDir,
    includeAllComponents,
    includeCliHome,
  });

  if (json) {
    printResult({
      json,
      data: {
        ok: true,
        stackName,
        editor,
        ...ws,
      },
    });
    return;
  }

  await openWorkspaceInEditor({ rootDir, editor, workspacePath: ws.workspacePath });
  console.log(`[stack] opened VS Code workspace for "${stackName}": ${ws.workspacePath}`);
}

export async function runStackWorkspaceCommand({ command, rootDir, stackName, json, flags }) {
  const options = resolveWorkspaceCommandOptions({ flags });
  if (command === 'code') {
    await runStackEditorWorkspaceCommand({
      rootDir,
      stackName,
      json,
      editor: 'code',
      ...options,
    });
    return;
  }

  if (command === 'open') {
    const editor = 'code';
    await runStackEditorWorkspaceCommand({
      rootDir,
      stackName,
      json,
      editor,
      ...options,
    });
    return;
  }

  throw new Error(`[stack] unsupported workspace command: ${command}`);
}

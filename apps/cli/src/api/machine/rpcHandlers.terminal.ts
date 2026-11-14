import { RPC_METHODS } from '@piggercode/protocol/rpc';
import {
  DaemonTerminalCloseRequestSchema,
  DaemonTerminalEnsureRequestSchema,
  DaemonTerminalInputRequestSchema,
  DaemonTerminalRepaintRequestSchema,
  DaemonTerminalResizeRequestSchema,
  DaemonTerminalRestartRequestSchema,
  DaemonTerminalStreamReadRequestSchema,
  type DaemonTerminalErrorCode,
  type DaemonTerminalLaunchIntent,
} from '@piggercode/protocol';
import { expandHomeDirPath } from '@/utils/path/expandHomeDirPath';

import type { RpcHandlerManager } from '../rpc/RpcHandlerManager';
import {
  authorizeFilesystemPath,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemPathAuthorization';
import {
  type FilesystemAccessPolicy,
  resolveFilesystemPolicyDefaultDirectory,
  resolveFilesystemAccessPolicy,
} from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import { resolveMachineRpcWorkingDirectory } from './resolveMachineRpcWorkingDirectory';
import { readDaemonTerminalPtyConfig } from '@/daemon/terminalPty/terminalPtyConfig';
import { createTerminalPtySessionManager, type TerminalPtySessionManager } from '@/daemon/terminalPty/terminalPtySessionManager';
import { createNodePtyProvider } from '@/integrations/pty/ptyProvider';
import { buildHappyCliSubprocessLaunchSpec } from '@/utils/spawnHappyCLI';
import { configuration } from '@/configuration';
import { readTerminalAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';

function err(errorCode: DaemonTerminalErrorCode): { ok: false; errorCode: DaemonTerminalErrorCode; error: DaemonTerminalErrorCode } {
  return { ok: false, errorCode, error: errorCode };
}

export function registerMachineTerminalRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerManager;
  deps?: Readonly<{
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    workingDirectory?: string;
    accessPolicy?: FilesystemAccessPolicy;
    sessionManager?: TerminalPtySessionManager;
    buildHappyCliSubprocessLaunchSpecFn?: typeof buildHappyCliSubprocessLaunchSpec;
    readTerminalAttachmentInfoFn?: typeof readTerminalAttachmentInfo;
  }>;
}>): void {
  const { rpcHandlerManager } = params;
  const env = params.deps?.env ?? process.env;
  const platform = params.deps?.platform ?? process.platform;

  const config = readDaemonTerminalPtyConfig(env);
  const accessPolicy = params.deps?.accessPolicy ?? resolveFilesystemAccessPolicy({ env, platform });
  const workingDirectory =
    params.deps?.workingDirectory
    ?? resolveFilesystemPolicyDefaultDirectory({
      defaultDirectory: resolveMachineRpcWorkingDirectory({ env, platform }),
      accessPolicy,
    });

  let sessionManager: TerminalPtySessionManager | null = params.deps?.sessionManager ?? null;
  const getSessionManager = (): TerminalPtySessionManager => {
    if (sessionManager) return sessionManager;
    sessionManager = createTerminalPtySessionManager({
      ptyProvider: createNodePtyProvider(),
      config: config.sessionManager,
      env,
      platform,
    });
    return sessionManager;
  };
  const buildHappyCliSubprocessLaunchSpecFn =
    params.deps?.buildHappyCliSubprocessLaunchSpecFn ?? buildHappyCliSubprocessLaunchSpec;
  const readTerminalAttachmentInfoFn = params.deps?.readTerminalAttachmentInfoFn ?? readTerminalAttachmentInfo;

  // A tmux client draws its whole view again, terminal modes included, when told its window changed (verified on
  // tmux 3.3a); other hosts are not known to, so their views keep attaching afresh. No record of the host: the same.
  const attachRedrawsOnWindowChange = async (sessionId: string): Promise<boolean> => {
    const info = await readTerminalAttachmentInfoFn({ happyHomeDir: configuration.happyHomeDir, sessionId });
    return info?.terminal?.mode === 'tmux';
  };

  const resolveLaunch = async (input: Readonly<{
    terminalKey?: string;
    launch?: DaemonTerminalLaunchIntent;
  }>): Promise<Readonly<{
    terminalKey: string;
    launch?: Readonly<{ file: string; args: readonly string[]; env?: Readonly<Record<string, string>> }>;
    repaintable?: boolean;
  }> | null> => {
    if (input.launch?.kind === 'session_attach') {
      const { sessionId, viewerId } = input.launch;
      let launchSpec: ReturnType<typeof buildHappyCliSubprocessLaunchSpecFn>;
      try {
        launchSpec = buildHappyCliSubprocessLaunchSpecFn(['attach', sessionId]);
      } catch {
        return null;
      }
      return {
        // One attach per app install: each device is its own tmux client, and tmux sizes the window for the one in
        // use. An app without a viewer id shares the session's one attach (and its size) with every other view.
        terminalKey: viewerId ? `session-attach:${sessionId}:${viewerId}` : `session-attach:${sessionId}`,
        launch: {
          file: launchSpec.filePath,
          args: launchSpec.args,
          ...(launchSpec.env ? { env: launchSpec.env } : {}),
        },
        repaintable: await attachRedrawsOnWindowChange(sessionId),
      };
    }
    if (input.launch?.kind === 'happier_cli') {
      try {
        const launchSpec = buildHappyCliSubprocessLaunchSpecFn(input.launch.args);
        return {
          terminalKey: input.terminalKey ?? `happier-cli:${JSON.stringify(input.launch.args)}`,
          launch: {
            file: launchSpec.filePath,
            args: launchSpec.args,
            ...(launchSpec.env ? { env: launchSpec.env } : {}),
          },
        };
      } catch {
        return null;
      }
    }
    return input.terminalKey ? { terminalKey: input.terminalKey } : null;
  };

  const resolveCwd = async (cwdInput: unknown): Promise<{ ok: true; cwd: string } | ReturnType<typeof err>> => {
    const raw = typeof cwdInput === 'string' && cwdInput.trim().length > 0 ? cwdInput.trim() : workingDirectory;
    const expanded = expandHomeDirPath(raw, env, platform);

    const validation = await authorizeFilesystemPath({
      targetPath: expanded,
      defaultDirectory: workingDirectory,
      accessPolicy,
      platform,
    });
    if (!validation.valid) {
      return err('terminal_cwd_denied');
    }
    return { ok: true, cwd: validation.resolvedPath };
  };

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_ENSURE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalEnsureRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    const cwd = await resolveCwd(parsed.data.cwd);
    if (!cwd.ok) return cwd;
    const resolvedLaunch = await resolveLaunch(parsed.data);
    if (!resolvedLaunch) return err('terminal_spawn_failed');

    return getSessionManager().ensure({
      terminalKey: resolvedLaunch.terminalKey,
      cwd: cwd.cwd,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      initialCommand: parsed.data.initialCommand,
      ...(resolvedLaunch.launch ? { launch: resolvedLaunch.launch } : {}),
      ...(resolvedLaunch.repaintable ? { repaintable: true } : {}),
    });
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_STREAM_READ, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalStreamReadRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    return await getSessionManager().read({
      terminalId: parsed.data.terminalId,
      cursor: parsed.data.cursor,
      maxBytes: parsed.data.maxBytes ?? config.readDefaults.maxBytes,
      maxEvents: parsed.data.maxEvents ?? config.readDefaults.maxEvents,
      ...(parsed.data.waitMs ? { waitMs: parsed.data.waitMs } : {}),
    });
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_INPUT, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalInputRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().input(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_RESIZE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalResizeRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().resize(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_CLOSE, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalCloseRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().close(parsed.data);
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_RESTART, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalRestartRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');

    const cwd = await resolveCwd(parsed.data.cwd);
    if (!cwd.ok) return cwd;
    const resolvedLaunch = await resolveLaunch(parsed.data);
    if (!resolvedLaunch) return err('terminal_spawn_failed');

    return getSessionManager().restart({
      terminalKey: resolvedLaunch.terminalKey,
      cwd: cwd.cwd,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      initialCommand: parsed.data.initialCommand,
      ...(resolvedLaunch.launch ? { launch: resolvedLaunch.launch } : {}),
      ...(resolvedLaunch.repaintable ? { repaintable: true } : {}),
    });
  });

  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_TERMINAL_REPAINT, async (raw: unknown) => {
    if (!config.enabled) return err('terminal_disabled');
    const parsed = DaemonTerminalRepaintRequestSchema.safeParse(raw);
    if (!parsed.success) return err('terminal_invalid_request');
    return getSessionManager().repaint(parsed.data);
  });
}

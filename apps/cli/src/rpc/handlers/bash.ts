import { logger } from '@/ui/logger';
import { exec, ExecOptions, spawn, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { MACHINE_COMMAND_DEFAULT_TIMEOUT_MS } from '@piggercode/protocol';
import type { FilesystemAccessPolicy } from './fileSystem/accessPolicy/filesystemAccessPolicy';
import { authorizeFilesystemPath } from './fileSystem/accessPolicy/filesystemPathAuthorization';
import { checkSharedFolderPath, isInSharedFolder } from '@/integrations/folderShare/sharedFolderMounts';

const execAsync = promisify(exec);

export interface BashRequest {
    command?: string;
    argv?: string[];
    cwd?: string;
    timeout?: number; // timeout in milliseconds
}

export type BashResponse = {
    success: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
};

async function executeArgvRequest(
    argv: readonly string[],
    options: Readonly<{ cwd?: string; timeout: number }>,
): Promise<BashResponse> {
    const [file, ...args] = argv;
    const spawnCwd = typeof options.cwd === 'string' ? options.cwd : undefined;
    const spawnOptions: SpawnOptions = {
        cwd: spawnCwd,
        windowsHide: true,
        shell: false,
    };

    return await new Promise<BashResponse>((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const child = spawn(file, args, spawnOptions);
        const timer = options.timeout > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill();
            }, options.timeout)
            : null;

        const finish = (result: BashResponse) => {
            if (settled) {
                return;
            }

            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            resolve(result);
        };

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            finish({
                success: false,
                stdout,
                stderr: stderr || error.message,
                exitCode: -1,
                error: error.message,
            });
        });

        child.on('close', (code) => {
            if (timedOut) {
                finish({
                    success: false,
                    stdout,
                    stderr,
                    exitCode: typeof code === 'number' ? code : -1,
                    error: 'Command timed out',
                });
                return;
            }

            if (code === 0) {
                finish({ success: true, stdout, stderr, exitCode: 0 });
                return;
            }

            finish({
                success: false,
                stdout,
                stderr: stderr || 'Command failed',
                exitCode: typeof code === 'number' ? code : -1,
                error: stderr || 'Command failed',
            });
        });
    });
}

/**
 * Runs a shell request in `cwd` (`undefined` = the shell's own default): `argv` without a shell, or
 * `command` in the platform's default shell. A command that runs reports its exit code; `timeout`
 * defaults to MACHINE_COMMAND_DEFAULT_TIMEOUT_MS.
 */
export async function executeShellCommandRequest(data: BashRequest, cwd: string | undefined): Promise<BashResponse> {
    try {
        // Never in a folder another computer shares here while it does not answer: the shell would wait
        // on its connection and hold this process (`checkSharedFolderPath`).
        if (typeof cwd === 'string' && isInSharedFolder(cwd)) {
            const shared = await checkSharedFolderPath(cwd);
            if (shared.problem) return { success: false, stdout: '', stderr: shared.problem, exitCode: 1, error: shared.problem };
        }
        // Build options with shell enabled by default
        // Note: ExecOptions doesn't support boolean for shell, but exec() uses the default shell when shell is undefined
        const options: ExecOptions = {
            cwd,
            timeout: data.timeout || MACHINE_COMMAND_DEFAULT_TIMEOUT_MS,
            windowsHide: true,
        };

        if (Array.isArray(data.argv) && data.argv.length > 0 && data.argv.every((value) => typeof value === 'string')) {
            logger.debug('Shell argv request executing...', { cwd: options.cwd, timeout: options.timeout, argc: data.argv.length });
            return await executeArgvRequest(data.argv, {
                cwd: typeof options.cwd === 'string' ? options.cwd : undefined,
                timeout: options.timeout ?? MACHINE_COMMAND_DEFAULT_TIMEOUT_MS,
            });
        }

        if (typeof data.command !== 'string' || data.command.length === 0) {
            return {
                success: false,
                stdout: '',
                stderr: 'Command failed',
                exitCode: 1,
                error: 'Command failed',
            };
        }

        logger.debug('Shell command executing...', { cwd: options.cwd, timeout: options.timeout });
        const { stdout, stderr } = await execAsync(data.command, options);
        logger.debug('Shell command executed, processing result...');

        const result = {
            success: true,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            exitCode: 0
        };
        logger.debug('Shell command result:', {
            success: true,
            exitCode: 0,
            stdoutLen: result.stdout.length,
            stderrLen: result.stderr.length
        });
        return result;
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string;
            stderr?: string;
            code?: number | string;
            killed?: boolean;
        };

        // Check if the error was due to timeout
        if (execError.code === 'ETIMEDOUT' || execError.killed) {
            const result = {
                success: false,
                stdout: execError.stdout || '',
                stderr: execError.stderr || '',
                exitCode: typeof execError.code === 'number' ? execError.code : -1,
                error: 'Command timed out'
            };
            logger.debug('Shell command timed out:', {
                success: false,
                exitCode: result.exitCode,
                error: 'Command timed out'
            });
            return result;
        }

        // If exec fails, it includes stdout/stderr in the error
        const result = {
            success: false,
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : 1,
            error: execError.message || 'Command failed'
        };
        logger.debug('Shell command failed:', {
            success: false,
            exitCode: result.exitCode,
            error: result.error,
            stdoutLen: result.stdout.length,
            stderrLen: result.stderr.length
        });
        return result;
    }
}

export function registerBashHandler(
    rpcHandlerManager: RpcHandlerRegistrar,
    workingDirectory: string,
    opts?: Readonly<{ accessPolicy?: FilesystemAccessPolicy }>,
): void {
    const accessPolicy = opts?.accessPolicy ?? { kind: 'osUser' };
    // Shell command handler - executes commands in the default shell
    rpcHandlerManager.registerHandler<BashRequest, BashResponse>(RPC_METHODS.BASH, async (data) => {
        logger.debug('Shell command request:', data.command);

        // Validate cwd if provided
        // Special case: "/" means "use shell's default cwd" (used by CLI detection)
        // Security: Still validate all other paths to prevent directory traversal
        let cwd: string | undefined = workingDirectory;
        if (data.cwd) {
            if (data.cwd === '/') {
                cwd = undefined;
            } else {
                const validation = await authorizeFilesystemPath({
                    targetPath: data.cwd,
                    defaultDirectory: workingDirectory,
                    accessPolicy,
                });
                if (!validation.valid) {
                    return { success: false, error: validation.error };
                }
                cwd = validation.resolvedPath;
            }
        }

        return await executeShellCommandRequest(data, cwd);
    });
}

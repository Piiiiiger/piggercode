import { z } from 'zod';

import { RPC_FORWARD_DEFAULT_MAX_TIMEOUT_MS } from './rpc.js';

/**
 * A shell command that an agent on one machine runs on another machine of the same account
 * (`machine.command.run`, carried by `RPC_METHODS.DAEMON_MACHINE_COMMAND_RUN`). The target machine
 * runs it only after its owner allowed remote commands there (`piggercode machine remote-commands on`);
 * the relay forwards the call like any other machine RPC.
 */

/** The timeout when the caller gives none; the machine `bash` RPC uses the same default. */
export const MACHINE_COMMAND_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Time the result needs to get back through the relay. A command's own timeout stays this far under
 * the relay's forwarding ceiling, so its result arrives before the relay stops waiting for it.
 */
export const MACHINE_COMMAND_REPLY_ALLOWANCE_MS = 15_000;

export const MACHINE_COMMAND_MAX_TIMEOUT_MS = RPC_FORWARD_DEFAULT_MAX_TIMEOUT_MS - MACHINE_COMMAND_REPLY_ALLOWANCE_MS;

const MachineCommandTimeoutMsSchema = z.number().int().positive().max(MACHINE_COMMAND_MAX_TIMEOUT_MS);

export const MachineCommandRunRequestSchema = z.object({
  command: z.string().min(1),
  /** Absolute, `~/…`, or relative to the machine's default directory (its home unless restricted). */
  cwd: z.string().min(1).optional(),
  timeoutMs: MachineCommandTimeoutMsSchema.optional(),
}).passthrough();
export type MachineCommandRunRequest = z.infer<typeof MachineCommandRunRequestSchema>;

export const MachineCommandErrorCodeSchema = z.enum([
  'remote_commands_disabled',
  'invalid_request',
  'cwd_not_allowed',
]);
export type MachineCommandErrorCode = z.infer<typeof MachineCommandErrorCodeSchema>;

/**
 * The machine `bash` RPC's result shape: a command that ran reports its exit code (a non-zero exit
 * has `success: false`); `errorCode` is set only when the machine refused to run it.
 */
export const MachineCommandRunResponseSchema = z.object({
  success: z.boolean(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
  errorCode: MachineCommandErrorCodeSchema.optional(),
}).passthrough();
export type MachineCommandRunResponse = z.infer<typeof MachineCommandRunResponseSchema>;

/** The action input: the request plus the machine to run it on. */
export const MachineCommandRunInputSchema = MachineCommandRunRequestSchema.extend({
  machineId: z.string().min(1),
});
export type MachineCommandRunInput = z.infer<typeof MachineCommandRunInputSchema>;

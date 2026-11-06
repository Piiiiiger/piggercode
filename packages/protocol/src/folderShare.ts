import { z } from 'zod';

/**
 * Shared folders: a folder of one machine of the account (the computer) mounted on another one (the
 * server), so that agents running on the server work on the computer's files.
 *
 * The computer's daemon owns its shares. The app's machine screen lists, adds and removes them through
 * `DAEMON_FOLDER_SHARE_LIST` / `_ADD` / `_REMOVE` on that machine. To add one, the computer asks the
 * server's daemon to accept its key (`DAEMON_FOLDER_SHARE_ACCEPT`, through the relay like any machine
 * RPC). The server authorizes the key for one thing only, mounting the computer's folders, and answers
 * with how to reach it over SSH and its host keys. The computer then connects out to the server and
 * serves the shared folder from a sandbox that contains nothing else of the computer; the server mounts
 * it with sshfs on that connection, in its home where the user chose (`~/code` by default).
 */

export const FolderShareStateSchema = z.enum([
  /** Started, waiting for the server to mount it. */
  'connecting',
  /** Mounted on the server. */
  'connected',
  /** The last connection ended (`error` says why); another attempt follows. */
  'retrying',
]);
export type FolderShareState = z.infer<typeof FolderShareStateSchema>;

export const FolderShareSchema = z.object({
  /** The shared folder, relative to the computer's home with `/` separators: `code`, `code/app`. */
  folder: z.string().min(1),
  serverMachineId: z.string().min(1),
  /** Where the server mounts it, as a `~/…` path on the server: `~/code`. */
  serverPath: z.string().min(1),
  state: FolderShareStateSchema,
  error: z.string().optional(),
}).passthrough();
export type FolderShare = z.infer<typeof FolderShareSchema>;

export const FolderShareListResponseSchema = z.object({
  shares: z.array(FolderShareSchema),
  /** Set when this machine cannot share folders: why, in words the app shows as they are. */
  unsupported: z.string().optional(),
}).passthrough();
export type FolderShareListResponse = z.infer<typeof FolderShareListResponseSchema>;

export const FolderShareAddRequestSchema = z.object({
  /** An absolute path on the computer (its folder browser's answer) or a path relative to its home. */
  folder: z.string().min(1),
  serverMachineId: z.string().min(1),
  /**
   * Where it shows on the server, inside the server's home: `code`, `~/code`, `projects/app`. The
   * folder's own name when absent. For a folder already shared with that server, it moves the share.
   */
  at: z.string().min(1).optional(),
}).passthrough();
export type FolderShareAddRequest = z.infer<typeof FolderShareAddRequestSchema>;

export const FolderShareRemoveRequestSchema = z.object({
  folder: z.string().min(1),
  serverMachineId: z.string().min(1),
}).passthrough();
export type FolderShareRemoveRequest = z.infer<typeof FolderShareRemoveRequestSchema>;

export const FolderShareErrorCodeSchema = z.enum([
  'invalid_request',
  /** This machine cannot share folders (its platform, or a missing tool). */
  'unsupported',
  /** Not a folder inside the home, or it overlaps a folder already shared with that server. */
  'folder_not_allowed',
  /** The server did not answer: it is offline, or its PiggerCode is too old for shared folders. */
  'server_unavailable',
  /** The server answered that it cannot take shared folders (no sshfs, no SSH address, …). */
  'server_refused',
]);
export type FolderShareErrorCode = z.infer<typeof FolderShareErrorCodeSchema>;

/** The answer to `_ADD` and `_REMOVE`: the machine's shares after the change, or why nothing changed. */
export const FolderShareMutationResponseSchema = z.union([
  z.object({ ok: z.literal(true), shares: z.array(FolderShareSchema) }).passthrough(),
  z.object({ ok: z.literal(false), errorCode: FolderShareErrorCodeSchema, error: z.string() }).passthrough(),
]);
export type FolderShareMutationResponse = z.infer<typeof FolderShareMutationResponseSchema>;

export const FolderShareAcceptRequestSchema = z.object({
  /** The computer's key: one `ssh-ed25519 <base64>` line, without options or comment. */
  publicKey: z.string().min(1),
  computerMachineId: z.string().min(1),
  /** The computer's name; the server names the computer after it (its label, in the forced command). */
  computerName: z.string().min(1),
  /**
   * Every place in the server's home this computer's folders show at (`code`, `projects/app`): the
   * server agrees to them, writes them into the key's forced command and mounts only there. Absent from
   * a computer before places, which keeps what it had.
   */
  places: z.array(z.string().min(1)).optional(),
}).passthrough();
export type FolderShareAcceptRequest = z.infer<typeof FolderShareAcceptRequestSchema>;

export const FolderShareAcceptErrorCodeSchema = z.enum([
  'invalid_request',
  /** sshfs is not installed on the server. */
  'sshfs_missing',
  /** The server does not know the SSH address other machines reach it at. */
  'ssh_address_missing',
  /** The server's SSH host keys cannot be read. */
  'host_keys_missing',
]);
export type FolderShareAcceptErrorCode = z.infer<typeof FolderShareAcceptErrorCodeSchema>;

export const FolderShareSshTargetSchema = z.object({
  user: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  /** The server's SSH host keys, `<type> <base64>` each, for the computer to trust and nothing else. */
  hostKeys: z.array(z.string().min(1)).min(1),
}).passthrough();
export type FolderShareSshTarget = z.infer<typeof FolderShareSshTargetSchema>;

export const FolderShareAcceptResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    ssh: FolderShareSshTargetSchema,
    /** The computer's folder on the server, as a `~/…` path, for a share from before places: `<root>/<folder>`. */
    root: z.string().min(1),
    /** The places the server agreed to (`places` of the request); absent from a server before places. */
    places: z.array(z.string()).optional(),
  }).passthrough(),
  z.object({ ok: z.literal(false), errorCode: FolderShareAcceptErrorCodeSchema, error: z.string() }).passthrough(),
]);
export type FolderShareAcceptResponse = z.infer<typeof FolderShareAcceptResponseSchema>;

import { z } from 'zod';

export const MachineFileBrowserRootSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  /**
   * Set on a server for a folder one of the user's computers shares with it, mounted there now (where
   * the user chose, `~/code` by default; the root's label is that place): which folder of which
   * computer it is. Readers that predate it show the root by its label.
   */
  sharedFolder: z.object({
    /** The folder on that computer, relative to its home: `code`, `code/app`. */
    folder: z.string().min(1),
    computerMachineId: z.string().min(1).optional(),
    /** The server's name for that computer, for when the reader does not know the machine. */
    computerLabel: z.string().min(1).optional(),
  }).passthrough().optional(),
}).passthrough();
export type MachineFileBrowserRoot = z.infer<typeof MachineFileBrowserRootSchema>;

export const MachineFileBrowserDirectoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(['file', 'directory', 'other']),
  size: z.number().int().nonnegative().optional(),
  modified: z.number().int().nonnegative().optional(),
}).passthrough();
export type MachineFileBrowserDirectoryEntry = z.infer<typeof MachineFileBrowserDirectoryEntrySchema>;

export const DaemonFilesystemListRootsResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    roots: z.array(MachineFileBrowserRootSchema),
  }).passthrough(),
  z.object({
    ok: z.literal(false),
    error: z.string().min(1),
    errorCode: z.string().min(1).optional(),
  }).passthrough(),
]);
export type DaemonFilesystemListRootsResponse = z.infer<typeof DaemonFilesystemListRootsResponseSchema>;

export const DaemonFilesystemListDirectoryRequestSchema = z.object({
  path: z.string().min(1),
  includeFiles: z.boolean().optional(),
  maxEntries: z.number().int().positive().nullable().optional(),
}).passthrough();
export type DaemonFilesystemListDirectoryRequest = z.infer<typeof DaemonFilesystemListDirectoryRequestSchema>;

export const DaemonFilesystemListDirectoryResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string().min(1),
    entries: z.array(MachineFileBrowserDirectoryEntrySchema),
    truncated: z.boolean(),
  }).passthrough(),
  z.object({
    ok: z.literal(false),
    error: z.string().min(1),
    errorCode: z.string().min(1).optional(),
  }).passthrough(),
]);
export type DaemonFilesystemListDirectoryResponse = z.infer<typeof DaemonFilesystemListDirectoryResponseSchema>;

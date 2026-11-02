import { SESSION_PERMISSION_MODES } from '@piggercode/protocol';

export const PERMISSION_MODES = SESSION_PERMISSION_MODES;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

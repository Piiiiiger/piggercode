/**
 * How long a deleted session stays in the trash (回收站) before it is deleted for good. The server's purge
 * rule, the CLI daemon's prune of its own trash, and the trash screen's "days left" all read this one value.
 */
export const SESSION_TRASH_RETENTION_DAYS = 7;

export const SESSION_TRASH_RETENTION_MS = SESSION_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

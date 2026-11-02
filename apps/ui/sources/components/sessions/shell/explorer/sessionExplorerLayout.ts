// Explorer row geometry, kept apart from the row components so a session row can line up with the
// folder rows without importing them (and their menus).
const INDENT_BASE = 12;
const INDENT_STEP = 14;
/** Width of a folder row's chevron, and the gap after it. */
export const SESSION_EXPLORER_CHEVRON_SLOT = 16;
export const SESSION_EXPLORER_CHEVRON_GAP = 2;

/** Where a row's icon starts at `depth`: a folder's icon, a session's agent mark and a note line up. */
export function sessionExplorerIconInset(depth: number): number {
    return INDENT_BASE + Math.max(0, Math.trunc(depth)) * INDENT_STEP + SESSION_EXPLORER_CHEVRON_SLOT + SESSION_EXPLORER_CHEVRON_GAP;
}

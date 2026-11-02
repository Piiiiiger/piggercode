import type { ScmBranchListEntry } from '@piggercode/protocol';

export function sortScmBranchListEntries(
    entries: ReadonlyArray<ScmBranchListEntry>,
): ReadonlyArray<ScmBranchListEntry> {
    return [...entries].sort((left, right) => {
        if (left.type !== right.type) {
            return left.type === 'local' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
    });
}

/**
 * How a folder one of the user's computers shares with a machine is named wherever it is offered:
 * "<computer> · <folder>". `computerName` is the computer's name when it is known here; otherwise the
 * machine's own label for it (the first part of the root's `<label>/<folder>`) stands in.
 */
export function sharedFolderTitle(
    root: Readonly<{ label: string; sharedFolder?: Readonly<{ folder: string }> }>,
    computerName: string | null | undefined,
): string {
    const computer = computerName || root.label.split('/')[0] || root.label;
    return `${computer} · ${root.sharedFolder?.folder ?? root.label}`;
}

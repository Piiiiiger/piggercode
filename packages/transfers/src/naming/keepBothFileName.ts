/**
 * The name a file takes when another file already has its name and both are kept:
 * `report.pdf` becomes `report (1).pdf`, then `report (2).pdf`. Clients and the CLI both use it,
 * so a folder never mixes two numbering styles.
 */
export function withKeepBothSuffix(fileName: string, n: number): string {
    const name = fileName.trim();
    const dot = name.lastIndexOf('.');
    // A leading dot (`.bashrc`) or a trailing one (`notes.`) does not start an extension.
    const hasExtension = dot > 0 && dot < name.length - 1;
    const stem = hasExtension ? name.slice(0, dot) : name;
    const extension = hasExtension ? name.slice(dot) : '';
    if (!stem) return fileName;
    return `${stem} (${n})${extension}`;
}

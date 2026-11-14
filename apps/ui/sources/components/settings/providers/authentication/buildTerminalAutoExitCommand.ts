/**
 * The command, then the shell exits: by default only when it succeeded (a failed login stays in its terminal to read
 * and try again); with `exit: 'always'` whatever happened, so a view without a terminal sees the login end.
 */
export function buildTerminalAutoExitCommand(
    command: string,
    platform: NodeJS.Platform | string | null | undefined,
    options?: Readonly<{ exit?: 'on_success' | 'always' }>,
): string {
    const trimmed = command.trim();
    if (!trimmed) return '';

    if (options?.exit === 'always') {
        return platform === 'win32' ? `${trimmed} & exit` : `${trimmed}; exit`;
    }

    if (platform === 'win32') {
        return `${trimmed} & if not errorlevel 1 exit`;
    }

    return `${trimmed}; __happier_auth_rc=$?; if [ \"$__happier_auth_rc\" -eq 0 ]; then exit; fi`;
}

// Built-in core slash commands available in any session, no user configuration needed. Each entry's
// body is sent verbatim to the agent when the user types the matching token.
//
// PiggerCode ships none: upstream's only entry, /happier-diagnose, diagnosed Happier itself and reported to
// its issue tracker and diagnostics service.

export type BuiltInPrompt = Readonly<{
    token: string;
    title: string;
    /** Markdown body sent to the agent as the user message. */
    body: string;
    /** Whether arguments after the token are appended to the body. */
    allowArgs: boolean;
}>;

export const BUILT_IN_PROMPTS: ReadonlyArray<BuiltInPrompt> = Object.freeze([]);

export function findBuiltInPrompt(token: string): BuiltInPrompt | null {
    const normalized = String(token ?? '').trim().toLowerCase();
    if (normalized.length === 0) return null;
    for (const entry of BUILT_IN_PROMPTS) {
        if (entry.token.toLowerCase() === normalized) return entry;
    }
    return null;
}

export type EmbeddedTerminalRendererHandle = Readonly<{
    write: (data: string) => void;
    /** Erases the screen; the program's modes stay. */
    clear: () => void;
    /** A new stream: screen and modes as fresh as a new view's. */
    reset: () => void;
}>;

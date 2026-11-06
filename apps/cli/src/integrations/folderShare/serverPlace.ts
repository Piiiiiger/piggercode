import { lstatSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether a place in this server's home (`serverLocation.ts`) can take a mount as it is on disk: every
 * part of it that exists is a real folder, never a symbolic link, which would lead the mount, or the
 * folders made for it, somewhere else. Null when it can; otherwise why not. Checked when the server
 * agrees to the place and again right before mounting there.
 */
export function serverPlaceProblem(homeDir: string, at: string): string | null {
  let path = homeDir;
  let shown = '~';
  for (const segment of at.split('/')) {
    path = join(path, segment);
    shown = `${shown}/${segment}`;
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(path);
    } catch (error) {
      // What does not exist yet is made as a plain folder; nothing below it exists either.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return `${shown} cannot be read: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (stats.isSymbolicLink()) return `${shown} is a symbolic link`;
    if (!stats.isDirectory()) return `${shown} is not a folder`;
  }
  return null;
}

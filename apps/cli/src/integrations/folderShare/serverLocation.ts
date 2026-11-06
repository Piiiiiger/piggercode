/**
 * Where a shared folder shows on the server: a folder in the server user's home, chosen when sharing.
 * By default it is the shared folder's own name beside the home's other folders (`~/code` for the
 * computer's `~/code`), and the user can name or place it otherwise (`projects/app`).
 *
 * The server agrees to each place when the app shares or moves the folder (the computer's accept
 * request, account-authenticated; the place is written into the key's forced command), and mounts
 * only there; the computer checks it too. One rule decides both: a folder inside the home, never a
 * hidden one (`~/.ssh`, `~/.config`: what runs or logs the user in lives there) and never `~/bin`,
 * which login shells put on the command path, never `~/local` (older shares sit there), with no quote
 * (the forced command quotes it). Whether it
 * is free (empty, no link on the way, no other computer's place) is the server's to check.
 */
export type ServerLocation = Readonly<{ ok: true; at: string }> | Readonly<{ ok: false; error: string }>;

/** The location a share takes when none was chosen: the folder's own name, in the server's home. */
export function defaultServerLocation(folder: string): string {
  const segments = folder.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? folder;
}

/** `code`, `~/code` or `projects/app/` as the home-relative location `serve` mounts at. */
export function parseServerLocation(raw: string): ServerLocation {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const relative = trimmed === '~' ? '' : trimmed.startsWith('~/') ? trimmed.slice(2) : trimmed;
  if (!relative) return { ok: false, error: 'Choose a folder inside the server\'s home, such as code.' };
  if (relative.startsWith('/')) return { ok: false, error: 'Give the location inside the server\'s home, such as code or projects/app.' };
  if (/[\x00-\x1f\x7f\\'"]/.test(relative)) return { ok: false, error: 'The location cannot contain control characters, quotes or backslashes.' };
  const segments = relative.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, error: 'The location cannot contain empty, . or .. parts.' };
  }
  if (segments.some((segment) => segment.startsWith('.') || segment.startsWith('-'))) {
    return { ok: false, error: 'The location cannot be a hidden folder or start with -.' };
  }
  if (segments[0] === 'bin') return { ok: false, error: '~/bin is where the server looks for commands; choose another name.' };
  // Where shares from before places sit (`~/local/<computer>/<folder>`), so no place may take it.
  if (segments[0] === 'local') return { ok: false, error: '~/local is where older shares sit; choose another place.' };
  return { ok: true, at: segments.join('/') };
}

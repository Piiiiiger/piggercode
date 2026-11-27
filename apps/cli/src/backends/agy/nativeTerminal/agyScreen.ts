/**
 * What agy's screen shows, read from a tmux capture with its colours kept (`capture-pane -e`; agy 1.5.18). The
 * input box is a line starting with the `>` prompt between two rules of `─`. An EMPTY box shows a grey
 * placeholder ("Auto mode: …") where a typed draft shows in the normal colour, so only the colours tell them
 * apart.
 */

// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[([0-9;]*)m/g;
// eslint-disable-next-line no-control-regex
const ANY_ESCAPE = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;

const stripEscapes = (text: string): string => text.replace(ANY_ESCAPE, '');

const isRule = (plainLine: string): boolean => /^─{10,}$/.test(plainLine.trim());

type Style = { dim: boolean; foreground: string | null };

function applySgr(style: Style, params: string): void {
  const codes = params === '' ? [0] : params.split(';').map((code) => Number(code));
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]!;
    if (code === 0) {
      style.dim = false;
      style.foreground = null;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 22) {
      style.dim = false;
    } else if (code === 39) {
      style.foreground = null;
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      style.foreground = String(code);
    } else if (code === 38) {
      if (codes[index + 1] === 5) {
        style.foreground = `38;5;${codes[index + 2]}`;
        index += 2;
      } else if (codes[index + 1] === 2) {
        style.foreground = 'rgb';
        index += 4;
      }
    }
  }
}

/** Grey, as agy colours a placeholder: bright black (90), faint, or the 256-colour grey ramp. */
function isGrey(style: Style): boolean {
  if (style.dim || style.foreground === '90' || style.foreground === '38;5;8') return true;
  const ramp = /^38;5;(\d+)$/.exec(style.foreground ?? '');
  return ramp !== null && Number(ramp[1]) >= 232;
}

/** True when some visible character of the line is not grey. */
function hasNonGreyText(rawLine: string): boolean {
  const style: Style = { dim: false, foreground: null };
  let found = false;
  let last = 0;
  const check = (text: string): void => {
    if (text.trim() !== '' && !isGrey(style)) found = true;
  };
  for (const match of rawLine.matchAll(SGR)) {
    check(stripEscapes(rawLine.slice(last, match.index)));
    applySgr(style, match[1] ?? '');
    last = match.index + match[0].length;
  }
  check(stripEscapes(rawLine.slice(last)));
  return found;
}

export type AgyInputBox = 'empty' | 'draft' | 'unknown';

/** The input box: the lines between the last two rules, when the first one starts with the `>` prompt. */
function findInputBox(plain: readonly string[]): Readonly<{ top: number; bottom: number }> | null {
  let bottom = -1;
  for (let index = plain.length - 1; index >= 0; index -= 1) {
    if (isRule(plain[index]!)) {
      bottom = index;
      break;
    }
  }
  if (bottom < 1) return null;
  let top = -1;
  for (let index = bottom - 1; index >= 0; index -= 1) {
    if (isRule(plain[index]!)) {
      top = index;
      break;
    }
  }
  if (top < 0 || top === bottom - 1) return null;
  return /^>(\s|$)/.test(plain[top + 1]!) ? { top, bottom } : null;
}

/**
 * Whether agy's input box holds text the user typed. `unknown`: no input box on screen (a dialog or a
 * confirmation covers it, or the screen is not agy's), which is never taken for an empty one.
 */
export function readAgyInputBox(screen: string): AgyInputBox {
  const lines = screen.split('\n');
  const box = findInputBox(lines.map(stripEscapes));
  if (!box) return 'unknown';
  for (let index = box.top + 1; index < box.bottom; index += 1) {
    // The prompt itself (the first `>`) is not the user's text.
    const raw = index === box.top + 1 ? lines[index]!.replace(/^((?:\u001b\[[0-9;]*m)*)>/, '$1') : lines[index]!;
    if (hasNonGreyText(raw)) return 'draft';
  }
  return 'empty';
}

/** agy's notice when the account's quota is used up: "⚠ Individual quota reached … Resets in …" (agy 1.5.18). */
const LIMIT_NOTICE = /^⚠\s*Individual quota reached/;
const OWN_NOTICE_LINE = /^(Resets in\b|Error ID:)/i;

/**
 * The quota-reached notices above the input box (a draft or the box's own text is the user's, not agy's), each
 * by its own text and the lines after it (the reset time and agy's `Error ID`), so a second notice is told from
 * the first and a notice that stays on screen is the same one.
 */
export function readAgyLimitNotices(screen: string): string[] {
  const plain = screen.split('\n').map((line) => stripEscapes(line).trim());
  const box = findInputBox(plain);
  const end = box ? box.top : plain.length;
  const notices: string[] = [];
  for (let index = 0; index < end; index += 1) {
    const line = plain[index]!;
    if (!LIMIT_NOTICE.test(line)) continue;
    // Its own lines only: the reset time and agy's `Error ID`, up to the first line that is anything else.
    const own = [line];
    for (let next = index + 1; next < end && OWN_NOTICE_LINE.test(plain[next]!); next += 1) own.push(plain[next]!);
    // The notice names when the quota resets, in its own words.
    if (!own.some((candidate) => /Resets in/i.test(candidate))) continue;
    notices.push(own.join('\n'));
  }
  return notices;
}

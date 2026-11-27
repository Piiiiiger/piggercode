import { describe, expect, it } from 'vitest';

import { readAgyInputBox, readAgyLimitNotices } from './agyScreen';

const ESC = '\u001b';
const RULE = '─'.repeat(100);

/** agy 1.5.18's screen as `tmux capture-pane -e` gives it (the account's email and folder left out). */
function screen(boxLines: readonly string[], options: Readonly<{ bottomRule?: string; above?: readonly string[] }> = {}): string {
  return [
    ` ${ESC}[1m${ESC}[94mAntigravity CLI 1.5.18${ESC}[0m`,
    `     ${ESC}[90mGemini 4 Neon (High)${ESC}[39m`,
    ...(options.above ?? []),
    RULE,
    ...boxLines,
    options.bottomRule ?? `${ESC}[90m${RULE}`,
    `? for shortcuts${ESC}[39m                                  ${ESC}[33mauto${ESC}[2m${ESC}[39m · Gemini 4 Neon · high`,
  ].join('\n');
}

describe('readAgyInputBox', () => {
  it('takes the grey placeholder of an empty box for empty', () => {
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[90mAuto mode: edits & safe commands auto-approved (shift+tab to cycle)`]))).toBe('empty');
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[90mPlan mode: research & plan only`], { bottomRule: RULE }))).toBe('empty');
  });

  it('takes other ways to draw a placeholder grey for empty too', () => {
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[2mAuto mode`]))).toBe('empty');
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[38;5;244mAuto mode`]))).toBe('empty');
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m `]))).toBe('empty');
  });

  it('takes text in the normal colour for a draft, including a draft that looks like the placeholder', () => {
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m hello draft`]))).toBe('draft');
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m Auto mode: edits & safe commands auto-approved`]))).toBe('draft');
    // Typed after the placeholder was shown: the placeholder goes, the text is plain.
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[0mx`]))).toBe('draft');
  });

  it('finds a draft on a later line of a box that holds several', () => {
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[90mAuto mode`, '  second line typed']))).toBe('draft');
  });

  it('is unknown, never empty, when no input box is on screen', () => {
    // A confirmation dialog: rules, but no prompt line.
    expect(readAgyInputBox(screen(['Run this command?', '  1. Yes', '  2. No']))).toBe('unknown');
    expect(readAgyInputBox('plain text only')).toBe('unknown');
    expect(readAgyInputBox('')).toBe('unknown');
    // Two rules with nothing between them.
    expect(readAgyInputBox(screen([]))).toBe('unknown');
  });

  it('reads the box nearest the bottom when older output above shows rules too', () => {
    const old = [RULE, `${ESC}[94m>${ESC}[39m an old line`, RULE];
    expect(readAgyInputBox(screen([`${ESC}[94m>${ESC}[39m ${ESC}[90mAuto mode`], { above: old }))).toBe('empty');
  });
});

describe('readAgyLimitNotices', () => {
  const NOTICE = '⚠ Individual quota reached. Resets in 3h 12m.';

  it('reads the notice with the line after it, and none when the screen shows none', () => {
    expect(readAgyLimitNotices(['hello', `${ESC}[33m${NOTICE}${ESC}[39m`, 'Error ID: abc-1', ''].join('\n'))).toEqual([`${NOTICE}\nError ID: abc-1`]);
    expect(readAgyLimitNotices('all fine')).toEqual([]);
  });

  it('takes only agy\'s own notice above the input box: not the same words in a draft, below it, or in other text', () => {
    const box = [RULE, `${ESC}[94m>${ESC}[39m ⚠ Individual quota reached. Resets in 1h`, `${ESC}[90m${RULE}`].join('\n');
    expect(readAgyLimitNotices(box)).toEqual([]);
    expect(readAgyLimitNotices([RULE, `${ESC}[94m>${ESC}[39m `, RULE, NOTICE, 'Error ID: abc-1'].join('\n'))).toEqual([]);
    expect(readAgyLimitNotices(['the docs say quota reached means wait', 'Individual quota reached? Resets in nowhere'].join('\n'))).toEqual([]);
    // Without the reset time it is not agy's notice.
    expect(readAgyLimitNotices(['⚠ Individual quota reached', 'something else'].join('\n'))).toEqual([]);
    expect(readAgyLimitNotices([NOTICE, 'Error ID: abc-1', RULE, `${ESC}[94m>${ESC}[39m ${ESC}[90mAuto mode`, `${ESC}[90m${RULE}`].join('\n'))).toHaveLength(1);
  });

  it('does not take text printed later below the notice for part of it', () => {
    const first = readAgyLimitNotices([NOTICE, 'Error ID: abc-1'].join('\n'));
    const later = readAgyLimitNotices([NOTICE, 'Error ID: abc-1', 'agy: thinking about something else'].join('\n'));
    expect(later).toEqual(first);
    // The reset time may be on its own line.
    expect(readAgyLimitNotices(['⚠ Individual quota reached.', 'Resets in 2h', 'Error ID: x', 'unrelated'].join('\n')))
      .toEqual(['⚠ Individual quota reached.\nResets in 2h\nError ID: x']);
  });

  it('tells a second notice from the first by its own text, and the same notice by being the same', () => {
    const first = readAgyLimitNotices([NOTICE, 'Error ID: abc-1'].join('\n'));
    const same = readAgyLimitNotices(['more output', NOTICE, 'Error ID: abc-1'].join('\n'));
    const second = readAgyLimitNotices([NOTICE, 'Error ID: abc-1', NOTICE, 'Error ID: def-2'].join('\n'));
    expect(same).toEqual(first);
    expect(second).toHaveLength(2);
    expect(second[1]).not.toEqual(first[0]);
  });
});

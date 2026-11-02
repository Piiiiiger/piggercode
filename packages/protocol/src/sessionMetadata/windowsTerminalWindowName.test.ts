import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOWS_TERMINAL_WINDOW_NAME,
  normalizeWindowsTerminalWindowName,
  WindowsTerminalWindowNameSchema,
} from './windowsTerminalWindowName.js';

describe('windowsTerminalWindowName', () => {
  it('normalizes empty and reserved Windows Terminal window names to the shared default', () => {
    expect(DEFAULT_WINDOWS_TERMINAL_WINDOW_NAME).toBe('piggercode');
    expect(normalizeWindowsTerminalWindowName('')).toBe('piggercode');
    expect(normalizeWindowsTerminalWindowName('   ')).toBe('piggercode');
    expect(normalizeWindowsTerminalWindowName('new')).toBe('piggercode');
    expect(normalizeWindowsTerminalWindowName('0')).toBe('piggercode');
  });

  it('preserves explicit named Windows Terminal windows', () => {
    expect(normalizeWindowsTerminalWindowName('  piggercode qa  ')).toBe('piggercode qa');
    expect(WindowsTerminalWindowNameSchema.parse('happier-dev')).toBe('happier-dev');
  });
});

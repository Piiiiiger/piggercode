import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import { renderHelpPage } from './helpPage.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

describe('renderHelpPage', () => {
  it('renders a banner, usage rows, and notes with stable structure', () => {
    const noColorChalk = Object.create(chalk) as typeof chalk;
    noColorChalk.level = 0;

    const out = renderHelpPage({
      title: 'piggercode auth',
      subtitle: 'Authentication management',
      usage: [
        { label: 'piggercode auth login', description: 'Authenticate with PiggerCode' },
        { label: 'piggercode auth status', description: 'Show authentication status' },
      ],
      notes: [
        'Use --json for scripting.',
        'Use --force to re-authenticate.',
      ],
    }, { chalkLike: noColorChalk });

    expect(stripAnsi(out)).toBe([
      'piggercode auth',
      'Authentication management',
      '',
      'Usage:',
      '  piggercode auth login   Authenticate with PiggerCode',
      '  piggercode auth status  Show authentication status',
      '',
      'Notes:',
      '- Use --json for scripting.',
      '- Use --force to re-authenticate.',
    ].join('\n'));
  });
});

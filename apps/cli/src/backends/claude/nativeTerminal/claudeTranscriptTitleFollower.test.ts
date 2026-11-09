import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeTranscriptTitleFollower } from './claudeTranscriptTitleFollower';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function transcript(lines: readonly unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-title-'));
  dirs.push(dir);
  const file = join(dir, 's.jsonl');
  await writeFile(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
}

describe('createClaudeTranscriptTitleFollower', () => {
  it('reports Claude\'s own title once, then only a change, and lets a rename win', async () => {
    const file = await transcript([
      { type: 'user', message: { role: 'user', content: 'fix the login bug' } },
      { type: 'ai-title', aiTitle: 'Login bug', sessionId: 's' },
    ]);
    const follower = createClaudeTranscriptTitleFollower(file);

    expect(await follower.readChanges()).toBe('Login bug');
    await appendFile(file, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Login bug', sessionId: 's' })}\n`);
    expect(await follower.readChanges()).toBeNull();

    await appendFile(file, `${JSON.stringify({ type: 'custom-title', customTitle: 'Auth work', sessionId: 's' })}\n`);
    expect(await follower.readChanges()).toBe('Auth work');
    await appendFile(file, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Session tokens', sessionId: 's' })}\n`);
    expect(await follower.readChanges()).toBeNull();
  });

  it('waits for a line Claude is still writing instead of losing it', async () => {
    const file = await transcript([{ type: 'user', message: { role: 'user', content: 'hi' } }]);
    const follower = createClaudeTranscriptTitleFollower(file);
    const line = JSON.stringify({ type: 'ai-title', aiTitle: 'Greeting', sessionId: 's' });

    await appendFile(file, line.slice(0, 20));
    expect(await follower.readChanges()).toBeNull();
    await appendFile(file, `${line.slice(20)}\n`);
    expect(await follower.readChanges()).toBe('Greeting');
  });

  it('steps over a record too large to read and still finds the title after it', async () => {
    const huge = { type: 'user', message: { role: 'user', content: 'x'.repeat(9 * 1024 * 1024) } };
    const file = await transcript([huge, { type: 'ai-title', aiTitle: 'After a big paste', sessionId: 's' }]);
    expect(await createClaudeTranscriptTitleFollower(file).readChanges()).toBe('After a big paste');
  });

  it('has no title before the transcript exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-title-'));
    dirs.push(dir);
    expect(await createClaudeTranscriptTitleFollower(join(dir, 'missing.jsonl')).readChanges()).toBeNull();
  });
});

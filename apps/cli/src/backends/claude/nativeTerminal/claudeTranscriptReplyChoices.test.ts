import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readClaudeLastReplyChoices } from './claudeTranscriptReplyChoices';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function transcript(records: readonly unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-reply-choices-'));
  dirs.push(dir);
  const path = join(dir, 'conversation.jsonl');
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return path;
}

/** A reply as Claude Code 2.1.x records it in the transcript. */
function reply(model: string, effort: string | null, extra: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    isSidechain: false,
    ...(effort ? { effort } : {}),
    requestedModel: model,
    message: { model, role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ...extra,
  };
}

describe('readClaudeLastReplyChoices', () => {
  it('reads the model and thinking level of the conversation\'s last reply', async () => {
    const path = await transcript([
      reply('claude-fable-5-2', 'xhigh'),
      { type: 'user', message: { role: 'user', content: 'what does "type":"assistant","effort":"low" mean?' } },
      reply('claude-opus-5-5', 'max'),
      // Claude's own notices (an API error) and a subagent's replies are not the conversation's choice.
      { type: 'assistant', isSidechain: false, message: { model: '<synthetic>', role: 'assistant', content: [] } },
      reply('claude-haiku-5-5', 'low', { isSidechain: true }),
      { type: 'system', subtype: 'turn_duration' },
    ]);
    await expect(readClaudeLastReplyChoices(path)).resolves.toEqual({ modelId: 'claude-opus-5-5', effort: 'max' });
  });

  it('finds that reply behind a long stretch of other records', async () => {
    const filler = Array.from({ length: 3_000 }, (_, index) => ({
      type: 'user',
      message: { role: 'user', content: `${'x'.repeat(200)} ${index}` },
    }));
    await expect(readClaudeLastReplyChoices(await transcript([reply('claude-opus-5-5', 'xhigh'), ...filler])))
      .resolves.toEqual({ modelId: 'claude-opus-5-5', effort: 'xhigh' });
  });

  it('keeps the model of a reply recorded without a thinking level, and has nothing for a conversation without replies', async () => {
    await expect(readClaudeLastReplyChoices(await transcript([reply('claude-opus-5-5', null)])))
      .resolves.toEqual({ modelId: 'claude-opus-5-5', effort: null });
    await expect(readClaudeLastReplyChoices(await transcript([{ type: 'user', message: { role: 'user', content: 'hi' } }])))
      .resolves.toBeNull();
    await expect(readClaudeLastReplyChoices(join(tmpdir(), 'no-such-claude-conversation.jsonl'))).resolves.toBeNull();
  });
});

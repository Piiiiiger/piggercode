import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withCopyLock } from './copyLock';

describe('withCopyLock', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'piggercode-copy-lock-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('runs callers of one key one after the other and leaves no lock behind', async () => {
    const order: string[] = [];
    const first = withCopyLock(dir, 'k', async () => { order.push('a-start'); await new Promise((r) => setTimeout(r, 30)); order.push('a-end'); });
    const second = withCopyLock(dir, 'k', async () => { order.push('b'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
    expect(await readdir(dir)).not.toContain('k.lock');
  });

  it('lets different keys run at the same time and propagates a failure without blocking the next caller', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = withCopyLock(dir, 'a', async () => { await gate; });
    await expect(withCopyLock(dir, 'b', async () => 'done')).resolves.toBe('done');
    release();
    await held;
    await expect(withCopyLock(dir, 'a', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withCopyLock(dir, 'a', async () => 'after')).resolves.toBe('after');
  });
});

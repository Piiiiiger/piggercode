import { describe, expect, it } from 'vitest';

import { normalizeEditInput, normalizeEditResult } from './edit';

describe('normalizeEditInput', () => {
  it('derives file_path from ACP diff items[0].path when missing', () => {
    const normalized = normalizeEditInput({
      items: [{ path: '/tmp/a.txt', oldText: 'old', newText: 'new', type: 'diff' }],
    });

    expect(normalized.file_path).toBe('/tmp/a.txt');
    expect(normalized.old_string).toBe('old');
    expect(normalized.new_string).toBe('new');
  });

  it('derives file_path from ACP single locations entry when missing', () => {
    const normalized = normalizeEditInput({
      locations: [{ path: '/tmp/b.txt' }],
      oldText: 'a',
      newText: 'b',
    });

    expect(normalized.file_path).toBe('/tmp/b.txt');
  });

  it('keeps explicit file_path over items[] and locations[] fallbacks', () => {
    const normalized = normalizeEditInput({
      file_path: '/tmp/explicit.txt',
      items: [{ path: '/tmp/from-item.txt', oldText: 'old', newText: 'new' }],
      locations: [{ path: '/tmp/from-location.txt' }],
    });

    expect(normalized.file_path).toBe('/tmp/explicit.txt');
  });

  it('does not derive file_path from locations when more than one location is provided', () => {
    const normalized = normalizeEditInput({
      locations: [{ path: '/tmp/one.txt' }, { path: '/tmp/two.txt' }],
      oldText: 'a',
      newText: 'b',
    });

    expect(normalized.file_path).toBeUndefined();
  });

  it('normalizes replaceAll to replace_all', () => {
    const normalized = normalizeEditInput({
      path: '/tmp/replace.txt',
      oldText: 'a',
      newText: 'b',
      replaceAll: true,
    });

    expect(normalized.replace_all).toBe(true);
  });
});

describe('normalizeEditResult', () => {
  it('extracts metadata.diff from metadata.filediff before/after', () => {
    const normalized = normalizeEditResult({
      metadata: {
        filediff: {
          file: 'a.txt',
          before: 'old content',
          after: 'new content',
        },
      },
    });

    const metadata = (normalized.metadata ?? {}) as Record<string, unknown>;
    expect(typeof metadata.diff).toBe('string');
    expect(String(metadata.diff)).toContain('--- a/a.txt');
    expect(String(metadata.diff)).toContain('+++ b/a.txt');
    expect(String(metadata.diff)).toContain('-old content');
    expect(String(metadata.diff)).toContain('+new content');
  });

  it('extracts metadata.diff when ACP wrappers nest JSON under output string', () => {
    const normalized = normalizeEditResult({
      output: JSON.stringify({
        metadata: {
          filediff: { file: '/tmp/wrapped.txt', before: 'before', after: 'after' },
        },
      }),
    });

    const metadata = (normalized.metadata ?? {}) as Record<string, unknown>;
    expect(typeof metadata.diff).toBe('string');
    expect(String(metadata.diff)).toContain('--- a//tmp/wrapped.txt');
    expect(String(metadata.diff)).toContain('+++ b//tmp/wrapped.txt');
    expect(String(metadata.diff)).toContain('-before');
    expect(String(metadata.diff)).toContain('+after');
  });
});

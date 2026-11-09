import { describe, expect, it } from 'vitest';

import type { Metadata } from '@/api/types';
import { applyProviderSessionInfoUpdate } from './providerSessionInfoState';

function createMetadata(overrides: Partial<Metadata> = {}): Metadata {
  return {
    path: '/workspace',
    host: 'machine',
    homeDir: '/home/tester',
    happyHomeDir: '/home/tester/.piggercode',
    happyLibDir: '/home/tester/.piggercode/lib',
    happyToolsDir: '/home/tester/.piggercode/tools',
    ...overrides,
  };
}

describe('applyProviderSessionInfoUpdate', () => {
  it('uses a provider title only to initialize an untitled PiggerCode session', () => {
    const initialized = applyProviderSessionInfoUpdate({
      metadata: createMetadata(),
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 100,
      update: { title: 'Provider title', updatedAt: '2026-07-11T10:00:00.000Z' },
    });

    expect(initialized.summary).toEqual({ text: 'Provider title', updatedAt: 100 });
    expect(initialized.providerSessionInfoV1).toEqual({
      v: 1,
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 100,
      title: 'Provider title',
      updatedAt: '2026-07-11T10:00:00.000Z',
    });

    const updated = applyProviderSessionInfoUpdate({
      metadata: initialized,
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 200,
      update: { title: 'Later provider title' },
    });

    expect(updated.summary).toEqual({ text: 'Provider title', updatedAt: 100 });
    expect(updated.providerSessionInfoV1?.title).toBe('Later provider title');
  });

  it('keeps a terminal session named after its CLI\'s title, until the session is named differently', () => {
    const named = applyProviderSessionInfoUpdate({
      metadata: createMetadata(),
      provider: 'claude',
      sessionId: 'c-1',
      observedAt: 100,
      update: { title: 'Fix login' },
      titlePolicy: 'follow',
    });
    const renamedInCli = applyProviderSessionInfoUpdate({
      metadata: named,
      provider: 'claude',
      sessionId: 'c-1',
      observedAt: 200,
      update: { title: 'Login fix, part 2' },
      titlePolicy: 'follow',
    });
    expect(renamedInCli.summary).toEqual({ text: 'Login fix, part 2', updatedAt: 200 });

    const nextConversation = applyProviderSessionInfoUpdate({
      metadata: renamedInCli,
      provider: 'claude',
      sessionId: 'c-2',
      observedAt: 300,
      update: { title: 'Release notes' },
      titlePolicy: 'follow',
    });
    expect(nextConversation.summary).toEqual({ text: 'Release notes', updatedAt: 300 });

    const renamedInApp = applyProviderSessionInfoUpdate({
      metadata: { ...nextConversation, summary: { text: 'My name', updatedAt: 400 } },
      provider: 'claude',
      sessionId: 'c-2',
      observedAt: 500,
      update: { title: 'Release notes v2' },
      titlePolicy: 'follow',
    });
    expect(renamedInApp.summary).toEqual({ text: 'My name', updatedAt: 400 });
  });

  it('never overwrites an explicit durable PiggerCode title', () => {
    const updated = applyProviderSessionInfoUpdate({
      metadata: createMetadata({
        summary: { text: 'Explicit PiggerCode title', updatedAt: 50 },
      }),
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 100,
      update: { title: 'Provider title' },
    });

    expect(updated.summary).toEqual({ text: 'Explicit PiggerCode title', updatedAt: 50 });
    expect(updated.providerSessionInfoV1?.title).toBe('Provider title');
  });

  it('retains omitted fields and records explicit provider clears without clearing the PiggerCode title', () => {
    const current = applyProviderSessionInfoUpdate({
      metadata: createMetadata({
        summary: { text: 'Explicit PiggerCode title', updatedAt: 50 },
      }),
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 100,
      update: { title: 'Provider title', updatedAt: '2026-07-11T10:00:00.000Z' },
    });
    const cleared = applyProviderSessionInfoUpdate({
      metadata: current,
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 200,
      update: { title: null },
    });

    expect(cleared.summary).toEqual({ text: 'Explicit PiggerCode title', updatedAt: 50 });
    expect(cleared.providerSessionInfoV1).toMatchObject({
      observedAt: 200,
      title: null,
      updatedAt: '2026-07-11T10:00:00.000Z',
    });
  });

  it('recovers from malformed legacy provider metadata instead of rejecting a valid partial update', () => {
    const updated = applyProviderSessionInfoUpdate({
      metadata: createMetadata({
        // Deliberately malformed persisted boundary fixture.
        providerSessionInfoV1: {
          v: 1,
          provider: 'codex',
          sessionId: 'codex-session-1',
          observedAt: 1,
          title: 'x'.repeat(2_000),
        } as never,
      }),
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 200,
      update: { updatedAt: '2026-07-11T10:00:00.000Z' },
    });

    expect(updated.providerSessionInfoV1).toEqual({
      v: 1,
      provider: 'codex',
      sessionId: 'codex-session-1',
      observedAt: 200,
      updatedAt: '2026-07-11T10:00:00.000Z',
    });
  });
});

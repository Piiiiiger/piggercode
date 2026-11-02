import { beforeEach, describe, expect, it, vi } from 'vitest';

const { codexHandlerSpy, passthroughSpy } = vi.hoisted(() => ({
  codexHandlerSpy: vi.fn(async () => {}),
  passthroughSpy: vi.fn(() => false),
}));

vi.mock('@/cli/commandRegistry', () => ({
  commandRegistry: {
    codex: codexHandlerSpy,
  },
}));

vi.mock('@/cli/providerCliPassthrough', () => ({
  maybePassthroughProviderCliInfoRequest: passthroughSpy,
}));

vi.mock('@/backends/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/backends/catalog')>();
  return {
    ...actual,
    requireCatalogEntry: vi.fn(() => ({
      getCliCommandHandler: async () => codexHandlerSpy,
    })),
  };
});

import { dispatchCli } from './dispatch';

describe('dispatchCli provider info passthrough', () => {
  beforeEach(() => {
    codexHandlerSpy.mockClear();
    passthroughSpy.mockReset();
    passthroughSpy.mockReturnValue(false);
  });

  it('lets provider command handlers render combined provider help', async () => {
    passthroughSpy.mockReturnValue(true);

    await dispatchCli({
      args: ['codex', '--help'],
      rawArgv: ['happier', 'codex', '--help'],
      terminalRuntime: null,
    });

    expect(passthroughSpy).not.toHaveBeenCalled();
    expect(codexHandlerSpy).toHaveBeenCalledWith({
      args: ['codex', '--help'],
      rawArgv: ['happier', 'codex', '--help'],
      terminalRuntime: null,
    });
  });
});

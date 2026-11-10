import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import type { Command } from './types';
import { buildCommandPaletteCommands } from './buildCommandPaletteCommands';

const createSessionActionDraftSpy = vi.fn();
let mockedState: any = null;
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    storage: {
    getState: () => mockedState,
  },
});
});

function commandTitles(cmds: readonly Command[]): string[] {
  return cmds.map((c) => c.title);
}

describe('buildCommandPaletteCommands', () => {
  it('delegates the new-session command to the caller-owned ordinary-entry callback', async () => {
    const push = vi.fn();
    const openNewSession = vi.fn();
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const commands = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: { memorySearchEnabled: false },
      nav: {
        push,
        openNewSession,
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    await commands.find((command) => command.id === 'new-session')?.action();

    expect(openNewSession).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalledWith('/new');
  });

  it('includes a memory search navigation command when enabled', async () => {
    const pushes: string[] = [];
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: { memorySearchEnabled: true },
      nav: {
        push: (path) => pushes.push(path),
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    const cmd = cmds.find((c) => c.id === 'memory-search');
    expect(cmd).toBeTruthy();
    await cmd!.action();
    expect(pushes).toEqual(['/search']);
  });

  it('uses registry-derived shortcut labels and omits stale display-only labels', async () => {
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: { memorySearchEnabled: false },
      shortcutLabels: {
        'commandPalette.open': 'Cmd+K',
        'session.new': 'Cmd+Shift+N',
      },
      nav: {
        push: () => {},
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    expect(cmds.find((command) => command.id === 'new-session')?.shortcut).toBe('Cmd+Shift+N');
    expect(cmds.find((command) => command.id === 'settings')?.shortcut).toBeUndefined();
    expect(cmds.some((command) => command.shortcut === '⌘N' || command.shortcut === '⌘,')).toBe(false);
  });

  it('omits the memory search navigation command when disabled', async () => {
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: { memorySearchEnabled: false },
      nav: {
        push: () => {},
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    expect(cmds.some((c) => c.id === 'memory-search')).toBe(false);
  });

  it('navigates to the terminal QR scanner from the connect terminal command', async () => {
    const pushes: string[] = [];
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: { memorySearchEnabled: false },
      nav: {
        push: (path) => pushes.push(path),
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    const cmd = cmds.find((c) => c.id === 'connect');
    expect(cmd).toBeTruthy();
    await cmd!.action();
    expect(pushes).toEqual(['/scan/terminal']);
  });

  it('registers pet commands when the companion feature is enabled', async () => {
    const pushes: string[] = [];
    const wake = vi.fn();
    const tuck = vi.fn();
    const resetPosition = vi.fn();
    const refreshCodexPets = vi.fn();
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: {
        memorySearchEnabled: false,
        petsCompanionEnabled: true,
      },
      petControls: {
        surface: 'desktopOverlay',
        wake,
        tuck,
        resetPosition,
        refreshCodexPets,
      },
      nav: {
        push: (path: string) => pushes.push(path),
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    expect(cmds.map((command) => command.id)).toEqual(expect.arrayContaining([
      'pet-wake',
      'pet-tuck',
      'pet-reset-position',
      'ui.pet.choose',
      'pet-refresh-codex',
    ]));
    expect(cmds.some((command) => command.id === 'pet-choose')).toBe(false);

    await cmds.find((command) => command.id === 'pet-wake')!.action();
    await cmds.find((command) => command.id === 'pet-tuck')!.action();
    await cmds.find((command) => command.id === 'pet-reset-position')!.action();
    await cmds.find((command) => command.id === 'pet-refresh-codex')!.action();
    await cmds.find((command) => command.id === 'ui.pet.choose')!.action();

    expect(wake).toHaveBeenCalledTimes(1);
    expect(tuck).toHaveBeenCalledTimes(1);
    expect(resetPosition).toHaveBeenCalledTimes(1);
    expect(refreshCodexPets).toHaveBeenCalledTimes(1);
    expect(pushes).toEqual(['/settings/pets']);
  });

  it('omits surface pet controls when only the settings chooser is available', async () => {
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: {
        memorySearchEnabled: false,
        petsCompanionEnabled: true,
      },
      petControls: {
        surface: 'none',
        wake: vi.fn(),
        tuck: vi.fn(),
        refreshCodexPets: vi.fn(),
      },
      nav: {
        push: () => {},
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    expect(cmds.some((command) => command.id === 'ui.pet.choose')).toBe(true);
    expect(cmds.some((command) => command.id === 'pet-choose')).toBe(false);
    expect(cmds.some((command) => command.id === 'pet-wake')).toBe(false);
    expect(cmds.some((command) => command.id === 'pet-tuck')).toBe(false);
    expect(cmds.some((command) => command.id === 'pet-reset-position')).toBe(false);
    expect(cmds.some((command) => command.id === 'pet-refresh-codex')).toBe(false);
  });

  it('omits pet commands when the companion feature is disabled', async () => {
    mockedState = { createSessionActionDraft: createSessionActionDraftSpy, settings: {} };

    const cmds = buildCommandPaletteCommands({
      sessionsById: {},
      isDev: false,
      activeSessionId: null,
      features: {
        memorySearchEnabled: false,
        petsCompanionEnabled: false,
      },
      petControls: {
        surface: 'desktopOverlay',
        wake: vi.fn(),
        tuck: vi.fn(),
        resetPosition: vi.fn(),
        refreshCodexPets: vi.fn(),
      },
      nav: {
        push: () => {},
        openNewSession: () => {},
        navigateToSession: () => {},
      },
      auth: { logout: async () => {} },
      actions: { execute: async () => ({ ok: true, result: {} }) },
      alert: async () => {},
    });

    expect(cmds.some((command) => command.id.startsWith('pet-'))).toBe(false);
  });
});

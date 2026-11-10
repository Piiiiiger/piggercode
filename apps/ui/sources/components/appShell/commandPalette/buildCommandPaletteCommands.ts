import type { ActionId } from '@piggercode/protocol';
import { listActionSpecs } from '@piggercode/protocol';

import type { Command } from './types';
import type { KeyboardCommandId } from '@/keyboard';
import { storage } from '@/sync/domains/state/storage';
import { isActionEnabledInState } from '@/sync/domains/settings/actionsSettings';
import { t } from '@/text';

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function extractRecentSessionIds(sessionsById: Record<string, any>): string[] {
  const sessions = Object.values(sessionsById ?? {});
  sessions.sort((a: any, b: any) => Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0));
  return sessions
    .map((s: any) => normalizeId(s?.id))
    .filter(Boolean)
    .slice(0, 5);
}

function readSessionLabel(session: any): Readonly<{ title: string; subtitle: string }> {
  const name = typeof session?.metadata?.name === 'string' ? session.metadata.name.trim() : '';
  const title = name || t('commandPalette.commands.sessionFallbackTitle', { id: String(session?.id ?? '').slice(0, 6) });
  const path = typeof session?.metadata?.path === 'string' ? session.metadata.path.trim() : '';
  const subtitle = path || t('commandPalette.commands.sessionFallbackSubtitle');
  return { title, subtitle };
}

export type PetCommandSurface = 'desktopOverlay' | 'appShell' | 'none';

export type PetCommandControls = Readonly<{
  surface: PetCommandSurface;
  wake: () => void | Promise<void>;
  tuck: () => void | Promise<void>;
  resetPosition?: () => void | Promise<void>;
  refreshCodexPets: () => void | Promise<void>;
}>;

export function buildCommandPaletteCommands(params: Readonly<{
  sessionsById: Record<string, any>;
  isDev: boolean;
  activeSessionId: string | null;
  features: Readonly<{
    memorySearchEnabled: boolean;
    petsCompanionEnabled?: boolean;
  }>;
  shortcutLabels?: Partial<Record<KeyboardCommandId, string>>;
  petControls?: PetCommandControls;
  nav: Readonly<{
    push: (path: string) => void;
    openNewSession: () => void;
    navigateToSession: (sessionId: string) => void;
  }>;
  auth: Readonly<{ logout: () => Promise<void> }>;
  actions: Readonly<{
    execute: (actionId: ActionId, parameters: unknown, ctx?: { defaultSessionId?: string | null }) => Promise<unknown>;
  }>;
  alert: (title: string, message: string) => void | Promise<void>;
}>): Command[] {
  const {
    sessionsById,
    isDev,
    activeSessionId,
    features,
    nav,
    auth,
    actions,
    alert,
  } = params;

  const cmds: Command[] = [
    {
      id: 'new-session',
      title: t('commandPalette.commands.newSessionTitle'),
      subtitle: t('commandPalette.commands.newSessionSubtitle'),
      icon: 'plus-circle',
      category: t('commandPalette.commands.sessionsCategory'),
      shortcut: params.shortcutLabels?.['session.new'],
      action: nav.openNewSession,
    },
    {
      id: 'sessions',
      title: t('commandPalette.commands.viewAllSessionsTitle'),
      subtitle: t('commandPalette.commands.viewAllSessionsSubtitle'),
      icon: 'chats-circle',
      category: t('commandPalette.commands.sessionsCategory'),
      action: () => nav.push('/'),
    },
    {
      id: 'settings',
      title: t('commandPalette.commands.settingsTitle'),
      subtitle: t('commandPalette.commands.settingsSubtitle'),
      icon: 'sliders-horizontal',
      category: t('commandPalette.commands.navigationCategory'),
      shortcut: params.shortcutLabels?.['settings.open'],
      action: () => nav.push('/settings'),
    },
    {
      id: 'account',
      title: t('commandPalette.commands.accountTitle'),
      subtitle: t('commandPalette.commands.accountSubtitle'),
      icon: 'user-circle',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/settings/account'),
    },
    {
      id: 'connect',
      title: t('commandPalette.commands.connectTerminalTitle'),
      subtitle: t('commandPalette.commands.connectTerminalSubtitle'),
      icon: 'link',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/scan/terminal'),
    },
  ];

  if (features.memorySearchEnabled) {
    cmds.push({
      id: 'memory-search',
      title: t('commandPalette.commands.memorySearchTitle'),
      subtitle: t('commandPalette.commands.memorySearchSubtitle'),
      icon: 'magnifying-glass',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/search'),
    });
  }

  if (features.petsCompanionEnabled === true) {
    const petCategory = t('commandPalette.pets.category');
    const petControls = params.petControls;
    if (petControls && petControls.surface !== 'none') {
      cmds.push(
        {
          id: 'pet-wake',
          title: t('commandPalette.pets.wakeTitle'),
          subtitle: t('commandPalette.pets.wakeSubtitle'),
          icon: 'paw-print',
          category: petCategory,
          action: () => petControls.wake(),
        },
        {
          id: 'pet-tuck',
          title: t('commandPalette.pets.tuckTitle'),
          subtitle: t('commandPalette.pets.tuckSubtitle'),
          icon: 'moon',
          category: petCategory,
          action: () => petControls.tuck(),
        },
      );
      if (petControls.resetPosition) {
        cmds.push({
          id: 'pet-reset-position',
          title: t('commandPalette.pets.resetPositionTitle'),
          subtitle: t('commandPalette.pets.resetPositionSubtitle'),
          icon: 'crosshair',
          category: petCategory,
          action: () => petControls.resetPosition?.(),
        });
      }
      cmds.push({
        id: 'pet-refresh-codex',
        title: t('commandPalette.pets.refreshCodexTitle'),
        subtitle: t('commandPalette.pets.refreshCodexSubtitle'),
        icon: 'arrow-clockwise',
        category: petCategory,
        action: () => petControls.refreshCodexPets(),
      });
    }
    cmds.push({
      id: 'ui.pet.choose',
      title: t('commandPalette.pets.chooseTitle'),
      subtitle: t('commandPalette.pets.chooseSubtitle'),
      icon: 'palette',
      category: petCategory,
      action: () => nav.push('/settings/pets'),
    });
  }

  for (const sessionId of extractRecentSessionIds(sessionsById)) {
    const session = sessionsById[sessionId];
    const label = readSessionLabel(session);
    cmds.push({
      id: `session-${sessionId}`,
      title: label.title,
      subtitle: label.subtitle,
      icon: 'clock',
      category: t('commandPalette.commands.recentSessionsCategory'),
      action: () => nav.navigateToSession(sessionId),
    });
  }

  const state = storage.getState() as any;
  const actionSpecs = listActionSpecs().filter((spec) =>
    isActionEnabledInState(state as any, spec.id, { surface: 'ui_button', placement: 'command_palette' } as any),
  );
  const commandPaletteActionSpecs = actionSpecs.filter((spec) => (spec.placements ?? []).includes('command_palette'));
  const byId = new Map(commandPaletteActionSpecs.map((spec) => [spec.id, spec]));



  cmds.push({
    id: 'sign-out',
    title: t('commandPalette.commands.signOutTitle'),
    subtitle: t('commandPalette.commands.signOutSubtitle'),
    icon: 'sign-out',
    category: t('commandPalette.commands.systemCategory'),
    action: async () => {
      await auth.logout();
    },
  });

  if (isDev) {
    cmds.push({
      id: 'dev-menu',
      title: t('commandPalette.commands.developerMenuTitle'),
      subtitle: t('commandPalette.commands.developerMenuSubtitle'),
      icon: 'code',
      category: t('commandPalette.commands.developerCategory'),
      action: () => nav.push('/dev'),
    });
  }

  return cmds;
}

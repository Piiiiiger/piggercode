import type { IconName } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type SessionRightTabId = 'git' | 'files' | 'terminal';

export function getSessionRightPanelTabs(terminalAvailable: boolean): ReadonlyArray<{
    id: SessionRightTabId;
    label: string;
    icon: IconName;
    badgeCount?: number;
    accessibilityLabel?: string;
}> {
    return [
        { id: 'git' as const, label: t('session.rightPanel.tabs.git'), icon: 'git-branch' as const },
        { id: 'files' as const, label: t('common.files'), icon: 'folder' as const },
        ...(terminalAvailable ? [{ id: 'terminal' as const, label: t('settings.terminal'), icon: 'terminal' as const }] : []),
    ];
}

import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type SessionExplorerMenuButtonProps = Readonly<{
    showHidden: boolean;
    onShowHiddenChange: (next: boolean) => void;
    hideInactiveSessions: boolean;
    onHideInactiveSessionsChange: (next: boolean) => void;
    onRefresh: () => void;
    onCollapseAll: () => void;
}>;

/** The explorer header's options, where the grouped list keeps its view menu. */
export function SessionExplorerMenuButton(props: SessionExplorerMenuButtonProps) {
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    const iconColor = theme.colors.text.secondary;
    const checkColor = theme.colors.accent.blue;

    const items = React.useMemo((): DropdownMenuItem[] => [
        {
            id: 'refresh',
            testID: 'session-explorer-refresh',
            title: t('sessionsList.explorerRefresh'),
            icon: <Icon name="arrows-clockwise" size={ICON_SIZE.sm} color={iconColor} />,
        },
        {
            id: 'collapse-all',
            testID: 'session-explorer-collapse-all',
            title: t('sessionsList.explorerCollapseAll'),
            icon: <Icon name="arrows-in" size={ICON_SIZE.sm} color={iconColor} />,
        },
        {
            id: 'show-hidden',
            testID: 'session-explorer-show-hidden',
            title: t('sessionsList.explorerShowHidden'),
            icon: <Icon name="eye" size={ICON_SIZE.sm} color={iconColor} />,
            rightElement: props.showHidden ? <Icon name="check" size={ICON_SIZE.sm} color={checkColor} /> : undefined,
        },
        {
            id: props.hideInactiveSessions ? 'show-inactive' : 'hide-inactive',
            testID: 'session-explorer-toggle-inactive',
            title: props.hideInactiveSessions
                ? t('sessionsList.showInactiveSessions')
                : t('sessionsList.hideInactiveSessions'),
            icon: <Icon name="funnel-simple" size={ICON_SIZE.sm} color={iconColor} />,
        },
    ], [checkColor, iconColor, props.hideInactiveSessions, props.showHidden]);

    const { onCollapseAll, onHideInactiveSessionsChange, onRefresh, onShowHiddenChange, showHidden } = props;
    const handleSelect = React.useCallback((itemId: string) => {
        if (itemId === 'refresh') onRefresh();
        else if (itemId === 'collapse-all') onCollapseAll();
        else if (itemId === 'show-hidden') onShowHiddenChange(!showHidden);
        else if (itemId === 'hide-inactive') onHideInactiveSessionsChange(true);
        else if (itemId === 'show-inactive') onHideInactiveSessionsChange(false);
    }, [onCollapseAll, onHideInactiveSessionsChange, onRefresh, onShowHiddenChange, showHidden]);

    return (
        <DropdownMenu
            open={open}
            onOpenChange={setOpen}
            items={items}
            onSelect={handleSelect}
            placement="left"
            variant="slim"
            matchTriggerWidth={false}
            maxWidthCap={260}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => (
                <Pressable
                    testID="session-explorer-menu-trigger"
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.explorerMenu')}
                    onPress={(event) => {
                        event?.stopPropagation?.();
                        toggle();
                    }}
                    hitSlop={8}
                >
                    <Icon name="dots-three" size={ICON_SIZE.sm} color={iconColor} />
                </Pressable>
            )}
        />
    );
}

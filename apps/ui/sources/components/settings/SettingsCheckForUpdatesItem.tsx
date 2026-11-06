import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { describeUpdateItem } from '@/components/updates/describeUpdateItem';
import { t } from '@/text';
import { useAppUpdateStatus, type AppUpdateStatus } from '@/updates/useAppUpdateStatus';

/**
 * Settings › About › Check for updates: this app's own update, on the same owner as the Updates
 * screen (`useAppUpdateStatus`). The row says where the app stands; pressing it checks now, or takes
 * the next step of an update that is waiting (download, restart). The chrome's Updates entry hides
 * itself when nothing is waiting, so this is the place a check can always be asked for.
 */
export function SettingsCheckForUpdatesItem() {
    const status = useAppUpdateStatus();
    return <CheckForUpdatesItem status={status} />;
}

export function CheckForUpdatesItem(props: Readonly<{ status: Pick<AppUpdateStatus, 'model' | 'run' | 'checkNow'> }>) {
    const { theme } = useUnistyles();
    const { model, run, checkNow } = props.status;
    const presentation = describeUpdateItem(model.item);
    const nextStep = model.item.action.kind === 'run';
    const onPress = React.useCallback(() => {
        void (nextStep ? run() : checkNow());
    }, [checkNow, nextStep, run]);
    return (
        <Item
            testID="settings-check-updates-row"
            title={t('updates.action.checkNow')}
            subtitle={presentation.subtitle}
            detail={nextStep ? presentation.actionLabel ?? undefined : undefined}
            icon={<Icon name="arrows-clockwise" size={29} color={theme.colors.text.secondary} />}
            onPress={onPress}
            showChevron={false}
        />
    );
}

import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { describeUpdateItem } from '@/components/updates/describeUpdateItem';
import { t } from '@/text';
import { useAppUpdateStatus, type AppUpdateStatus } from '@/updates/useAppUpdateStatus';
import { useUpdateCheckInFlight } from '@/updates/updateCheckInFlight';
import { useCheckForUpdatesNow } from '@/updates/useCheckForUpdatesNow';
import { formatLastSeen } from '@/utils/sessions/sessionUtils';

/**
 * Settings › About › Check for updates: this app's own update, on the same owner as the Updates
 * screen (`useAppUpdateStatus`). The row says where the app stands; pressing it checks everything
 * now — this app and every online machine, the same check as the Updates screen's — or takes the
 * next step of an app update that is waiting (download, restart). The chrome's Updates entry hides
 * itself when nothing is waiting, so this is the place a check can always be asked for. While a
 * check runs (from here or the Updates screen) the row spins and says so; afterwards it says when the
 * app last checked, so a check that found nothing new still shows it happened.
 */
export function SettingsCheckForUpdatesItem() {
    const status = useAppUpdateStatus();
    const checkNow = useCheckForUpdatesNow(status.checkNow);
    const checking = useUpdateCheckInFlight();
    return (
        <CheckForUpdatesItem
            status={{ model: status.model, run: status.run, checkNow, checkedAt: status.checkedAt }}
            checking={checking}
        />
    );
}

export function CheckForUpdatesItem(props: Readonly<{
    status: Pick<AppUpdateStatus, 'model' | 'run' | 'checkNow'> & Partial<Pick<AppUpdateStatus, 'checkedAt'>>;
    /** A check started here or on another surface is still running. */
    checking?: boolean;
}>) {
    const { theme } = useUnistyles();
    const { model, run, checkNow } = props.status;
    const presentation = describeUpdateItem(model.item);
    const nextStep = model.item.action.kind === 'run';
    const checking = props.checking === true;
    const checkedAt = props.status.checkedAt ?? null;
    const subtitle = checking
        ? t('updates.row.checking')
        : checkedAt == null
            ? presentation.subtitle
            : presentation.subtitle
                ? t('updates.row.withCheckedAt', { status: presentation.subtitle, time: formatLastSeen(checkedAt) })
                : t('updates.summary.checkedAt', { time: formatLastSeen(checkedAt) });
    const onPress = React.useCallback(() => {
        void (nextStep ? run() : checkNow());
    }, [checkNow, nextStep, run]);
    return (
        <Item
            testID="settings-check-updates-row"
            title={t('updates.action.checkNow')}
            subtitle={subtitle}
            detail={nextStep ? presentation.actionLabel ?? undefined : undefined}
            icon={<Icon name="arrows-clockwise" size={29} color={theme.colors.text.secondary} />}
            onPress={onPress}
            loading={checking}
            showChevron={false}
        />
    );
}

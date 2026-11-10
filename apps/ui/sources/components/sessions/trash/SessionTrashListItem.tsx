import * as React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { useSessionTrashCount } from '@/sync/domains/session/trash/sessionTrashStore';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { t } from '@/text';

/** The trash (回收站) entry at the bottom of the sidebar session list; it shows how many sessions are in it. */
export const SessionTrashListItem = React.memo(function SessionTrashListItem() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const count = useSessionTrashCount();

    React.useEffect(() => {
        fireAndForget(sync.refreshTrashedSessions(), { tag: 'SessionTrashListItem.refresh' });
    }, []);

    return (
        <Item
            title={t('sessionTrash.title')}
            icon={<Icon name="trash" size={20} color={theme.colors.text.secondary} />}
            detail={count > 0 ? String(count) : undefined}
            onPress={() => router.push('/session/trash')}
        />
    );
});

import * as React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';

import { MachineFilePreviewView } from '@/components/machines/files/MachineFilePreviewView';

/** A file on a machine, opened from the session explorer's Files view: `/machine/<id>/file?path=…&serverId=…`. */
export default function MachineFileScreen() {
    const params = useLocalSearchParams<{ id?: string; path?: string; serverId?: string }>();
    const machineId = typeof params.id === 'string' ? params.id : '';
    const path = typeof params.path === 'string' ? params.path : '';
    const serverId = typeof params.serverId === 'string' && params.serverId.length > 0 ? params.serverId : null;
    const title = path.slice(path.lastIndexOf('/') + 1) || path;
    const screenOptions = React.useMemo(() => ({ title }), [title]);
    return (
        <>
            <Stack.Screen options={screenOptions} />
            <MachineFilePreviewView machineId={machineId} serverId={serverId} path={path} />
        </>
    );
}

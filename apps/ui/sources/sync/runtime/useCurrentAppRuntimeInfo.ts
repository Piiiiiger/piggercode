import * as React from 'react';

import { isTauriDesktop } from '@/utils/platform/tauri';
import { fireAndForget } from '@/utils/system/fireAndForget';

import {
    readCurrentAppRuntimeInfo,
    readDesktopShellRuntimeInfo,
    type CurrentAppRuntimeInfo,
} from './readCurrentAppRuntimeInfo';

/** The app's runtime details. In the desktop app, the shell's own version and id arrive just after mount. */
export function useCurrentAppRuntimeInfo(): CurrentAppRuntimeInfo {
    const [info, setInfo] = React.useState(readCurrentAppRuntimeInfo);

    React.useEffect(() => {
        if (!isTauriDesktop()) return;
        let active = true;
        fireAndForget(
            readDesktopShellRuntimeInfo().then((shell) => {
                if (active) setInfo((current) => ({ ...current, ...shell }));
            }),
            { tag: 'useCurrentAppRuntimeInfo.readDesktopShell' },
        );
        return () => {
            active = false;
        };
    }, []);

    return info;
}

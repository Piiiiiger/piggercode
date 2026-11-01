import type { SessionListViewItem } from './sessionListViewData';
import type { SessionStorageKind } from '../sessionStorageKind';
import { getSessionStorageKind } from '../sessionStorageKind';
import { filterSessionListViewDataSessions } from './filterSessionListViewDataSessions';

export function filterSessionListViewDataByStorageKind(
    source: ReadonlyArray<SessionListViewItem>,
    storageKind: SessionStorageKind,
): SessionListViewItem[] {
    return filterSessionListViewDataSessions(source, (session) => getSessionStorageKind(session) === storageKind);
}

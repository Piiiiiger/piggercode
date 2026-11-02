import type { SessionOrganizationSnapshotRequest } from '@piggercode/protocol';

export function createSessionListOrganizationSnapshotRequest(): Partial<SessionOrganizationSnapshotRequest> {
    return {
        includeFolders: true,
        includeTags: true,
        includeLabels: true,
        includeAllFolderAssignments: true,
        includeAllTagAssignments: true,
        includeAttentionStandings: true,
        includeAttentionReminderTimes: true,
    };
}

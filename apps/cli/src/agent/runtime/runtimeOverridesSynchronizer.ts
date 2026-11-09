import type { Metadata, PermissionMode } from '@/api/types';

import {
  resolveModelOverrideFromMetadataSnapshot,
  resolvePermissionIntentFromMetadataSnapshot,
} from './permission/permissionModeFromMetadata';
import { applyStartupPermissionModeSeed } from './permission/permissionModeStateSync';

type RuntimePermissionModeRef = { current: PermissionMode; updatedAt: number };
type RuntimeModelOverrideRef = { current: string | null; updatedAt: number };

type SyncSnapshot = {
  permissionMode: RuntimePermissionModeRef;
  modelOverride: RuntimeModelOverrideRef;
};

export async function initializeRuntimeOverridesSynchronizer(params: Readonly<{
  explicitPermissionMode: PermissionMode | undefined;
  sessionKind: 'fresh' | 'attach' | 'resume';
  take?: number;
  session: {
    getMetadataSnapshot: () => Metadata | null;
    fetchLatestUserPermissionIntentFromTranscript: (
      opts?: Readonly<{ take?: number }>,
    ) => Promise<{ intent: PermissionMode; updatedAt: number } | null>;
  };
  permissionMode: RuntimePermissionModeRef;
  modelOverride: RuntimeModelOverrideRef;
  onPermissionModeApplied?: () => void;
  onModelOverrideApplied?: () => void;
}>): Promise<{
  getSnapshot: () => SyncSnapshot;
  seedFromSession: () => Promise<void>;
  syncFromMetadata: () => void;
}> {
  const snapshot: SyncSnapshot = {
    permissionMode: params.permissionMode,
    modelOverride: params.modelOverride,
  };

  const explicitPermissionMode = params.explicitPermissionMode;
  // An explicit mode is the newest choice when this process starts: saved metadata from before
  // must not replace it, but a mode picked in the app afterwards must (switching to YOLO while a
  // permission prompt waits has to reach the running turn). Without its own timestamp (a terminal
  // flag) the explicit mode counts as chosen now.
  const explicitPermissionModeChosenAt = explicitPermissionMode
    ? (snapshot.permissionMode.updatedAt > 0 ? snapshot.permissionMode.updatedAt : Date.now())
    : 0;

  const applyPermissionMode = (next: { intent: PermissionMode; updatedAt: number } | null): void => {
    if (!next) return;
    if (next.updatedAt <= snapshot.permissionMode.updatedAt) return;
    if (next.updatedAt <= explicitPermissionModeChosenAt) return;
    snapshot.permissionMode.current = next.intent;
    snapshot.permissionMode.updatedAt = next.updatedAt;
    params.onPermissionModeApplied?.();
  };

  const applyModelOverride = (next: { modelId: string; updatedAt: number } | null): void => {
    if (!next) return;
    if (next.updatedAt <= snapshot.modelOverride.updatedAt) return;
    snapshot.modelOverride.current = next.modelId;
    snapshot.modelOverride.updatedAt = next.updatedAt;
    params.onModelOverrideApplied?.();
  };

  const seedFromSession = async (): Promise<void> => {
    if (explicitPermissionMode) {
      snapshot.permissionMode.current = explicitPermissionMode;
      params.onPermissionModeApplied?.();
      return;
    }

    await applyStartupPermissionModeSeed({
      explicitPermissionMode,
      sessionKind: params.sessionKind,
      session: params.session,
      currentPermissionModeUpdatedAt: snapshot.permissionMode.updatedAt,
      take:
        typeof params.take === 'number' && Number.isFinite(params.take) && params.take > 0
          ? Math.floor(params.take)
          : 50,
      apply: ({ mode, updatedAt }) => {
        snapshot.permissionMode.current = mode;
        snapshot.permissionMode.updatedAt = updatedAt;
        params.onPermissionModeApplied?.();
      },
    });
  };

  const syncFromMetadata = (): void => {
    const metadata = params.session.getMetadataSnapshot();
    applyPermissionMode(resolvePermissionIntentFromMetadataSnapshot({ metadata }));
    applyModelOverride(resolveModelOverrideFromMetadataSnapshot({ metadata }));
  };

  return {
    getSnapshot: () => snapshot,
    seedFromSession,
    syncFromMetadata,
  };
}

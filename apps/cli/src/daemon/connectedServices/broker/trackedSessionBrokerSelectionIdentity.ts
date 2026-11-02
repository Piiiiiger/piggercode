import {
  PIGGERCODE_SESSION_CONNECTED_SERVICE_BROKER_SELECTION_IDENTITY_ENV_KEY,
  readSessionConnectedServiceBrokerSelectionIdentity,
} from '@/agent/runtime/sessionConnectedServiceBrokerSelectionIdentityEnv';
import type { TrackedSession } from '@/daemon/types';

export function readTrackedSessionBrokerSelectionIdentity(tracked: Pick<
  TrackedSession,
  'happySessionMetadataFromLocalWebhook' | 'spawnOptions'
> | null): string | null {
  if (!tracked) return null;
  const currentIdentity = readSessionConnectedServiceBrokerSelectionIdentity(
    tracked.happySessionMetadataFromLocalWebhook?.connectedServiceBrokerSelectionIdentityV1,
  ) ?? readSessionConnectedServiceBrokerSelectionIdentity(
    tracked.spawnOptions?.environmentVariables?.[
      PIGGERCODE_SESSION_CONNECTED_SERVICE_BROKER_SELECTION_IDENTITY_ENV_KEY
    ],
  );
  return currentIdentity ?? null;
}

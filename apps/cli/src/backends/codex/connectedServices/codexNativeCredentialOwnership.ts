import { join } from 'node:path';

import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';
import type { ConnectedServiceNativeCredentialOwnership } from '@/daemon/connectedServices/credentials/lifecycleTypes';

import {
  markCodexAuthStoreRotationSynced,
  markCodexAuthStoreRotationUploading,
  readCodexAuthStoreRotation,
} from './writeCodexAuthStoreFile';

function readAccessTokenExpiresAt(accessToken: string): number | null {
  const exp = decodeJwtPayload(accessToken)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? Math.trunc(exp * 1000) : null;
}

/**
 * A Codex CLI with a materialized home refreshes its ChatGPT login itself and rewrites `auth.json`,
 * so while it runs it owns the refresh token; the daemon reads its rotations back from that file.
 */
export const codexNativeCredentialOwnership: ConnectedServiceNativeCredentialOwnership = {
  serviceIds: ['openai-codex'],
  readRotation: async ({ materializedRoot, record }) => {
    const codexHome = join(materializedRoot, 'codex-home');
    const rotation = await readCodexAuthStoreRotation({ codexHome, record });
    if (rotation.kind === 'none') return rotation;
    return {
      kind: 'rotated',
      sourceUnchanged: rotation.sourceUnchanged,
      next: {
        accessToken: rotation.tokens.access_token,
        refreshToken: rotation.tokens.refresh_token,
        idToken: rotation.tokens.id_token,
        providerAccountId: rotation.tokens.account_id,
        expiresAt: readAccessTokenExpiresAt(rotation.tokens.access_token),
      },
      markUploading: async () => await markCodexAuthStoreRotationUploading({ codexHome, tokens: rotation.tokens, base: record }),
      markSynced: async () => await markCodexAuthStoreRotationSynced({ codexHome, tokens: rotation.tokens }),
    };
  },
};

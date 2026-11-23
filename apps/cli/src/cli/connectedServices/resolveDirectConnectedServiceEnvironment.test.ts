import { describe, expect, it } from 'vitest';
import { accountSettingsParse } from '@piggercode/protocol';

import { resetProcessConnectedServiceManagementForTests } from '@/daemon/connectedServices/management/connectedServiceManagement';
import {
  resolveDirectConnectedServiceEnvironment,
  resolveDirectConnectedServiceMaterializationIdentity,
} from './resolveDirectConnectedServiceEnvironment';

describe('resolveDirectConnectedServiceMaterializationIdentity', () => {
  it('creates a stable materialization identity for a fresh direct connected-service launch', () => {
    const identity = resolveDirectConnectedServiceMaterializationIdentity(null);

    expect(identity).toEqual({
      v: 1,
      id: expect.stringMatching(/^csm_[0-9a-f]{32}$/),
      createdAtMs: expect.any(Number),
    });
  });

  it('preserves the persisted identity for a direct resume', () => {
    const persisted = {
      v: 1 as const,
      id: 'csm_0123456789abcdef0123456789abcdef',
      createdAtMs: 1_786_000_000_000,
    };

    expect(resolveDirectConnectedServiceMaterializationIdentity({
      connectedServiceMaterializationIdentityV1: persisted,
    })).toEqual(persisted);
  });
});

describe('resolveDirectConnectedServiceEnvironment', () => {
  it('refuses a subscription login outside the daemon before reading any credential', async () => {
    // A direct `piggercode codex` process is not the daemon: only the daemon holds subscription logins.
    resetProcessConnectedServiceManagementForTests();

    await expect(resolveDirectConnectedServiceEnvironment({
      agentId: 'codex',
      credentials: { token: 'happy-token', encryption: { type: 'legacy', secret: new Uint8Array(32).fill(7) } },
      accountSettings: accountSettingsParse({}),
      directory: '/tmp/project',
      sessionId: 'session-1',
      connectedServices: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' } },
      },
    })).rejects.toMatchObject({
      name: 'ConnectedServiceManagementDeniedError',
      serviceId: 'openai-codex',
      reason: 'requires_daemon',
    });
  });
});

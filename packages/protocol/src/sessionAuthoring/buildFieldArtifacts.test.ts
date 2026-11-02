import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  SESSION_AUTHORING_FIELD_IDS,
  SESSION_AUTHORING_FIELD_DESCRIPTORS,
  SYNCED_SESSION_AUTHORING_FIELD_IDS_V1,
  SyncedSessionAuthoringFieldIdV1Schema,
  SyncedSessionAuthoringValueV1Schema,
  SessionAuthoringValueV1Schema,
  type SessionAuthoringFieldId,
  type SessionAuthoringValueV1,
  type SyncedSessionAuthoringFieldIdV1,
  type SyncedSessionAuthoringValueV1,
} from './index.js';

describe('sessionAuthoring field artifacts', () => {
  it('derives stable field ids and descriptors from one catalog', () => {
    expect(SESSION_AUTHORING_FIELD_IDS).toContain('targetType');
    expect(SESSION_AUTHORING_FIELD_IDS).toContain('directory');
    expect(SESSION_AUTHORING_FIELD_IDS).toContain('backendTarget');
    expect(SESSION_AUTHORING_FIELD_IDS).toContain('automation');
    expect(SESSION_AUTHORING_FIELD_IDS).not.toContain('workspaceId');
    expect(SESSION_AUTHORING_FIELD_IDS).not.toContain('workspaceLocationId');
    expect(SESSION_AUTHORING_FIELD_IDS).not.toContain('workspaceCheckoutId');

    expect(SESSION_AUTHORING_FIELD_DESCRIPTORS.targetType.storageClass).toBe('template');
    expect(SESSION_AUTHORING_FIELD_DESCRIPTORS.existingSessionId.defaultEditabilityByContext.automationExistingSession).toBe('inherited');

    expectTypeOf<SessionAuthoringFieldId>().toMatchTypeOf<(typeof SESSION_AUTHORING_FIELD_IDS)[number]>();
  });

  it('rejects invalid authored values', () => {
    expect(() => SessionAuthoringValueV1Schema.parse({
      targetType: 'unknown',
      directory: '/tmp/project',
    })).toThrow();

    expect(() => SessionAuthoringValueV1Schema.parse({
      targetType: 'new_session',
      directory: '',
    })).toThrow();

    expect(() => SessionAuthoringValueV1Schema.parse({
      targetType: 'new_session',
      directory: '/tmp/project',
      codexBackendMode: 'bad-mode',
    })).toThrow();

    expect(() => SessionAuthoringValueV1Schema.parse({
      targetType: 'new_session',
      directory: '/tmp/project',
      workspaceId: 'workspace-1',
    })).toThrow();
  });

  it('derives the synchronized draft projection from explicit catalog storage dispositions', () => {
    expectTypeOf<SyncedSessionAuthoringFieldIdV1>().not.toEqualTypeOf<never>();
    expectTypeOf<'directory'>().toMatchTypeOf<SyncedSessionAuthoringFieldIdV1>();
    expectTypeOf<SyncedSessionAuthoringValueV1>().toHaveProperty('directory');
    expect(SYNCED_SESSION_AUTHORING_FIELD_IDS_V1).toEqual(
      SESSION_AUTHORING_FIELD_IDS.filter((fieldId) => (
        SESSION_AUTHORING_FIELD_DESCRIPTORS[fieldId].draftStorage === 'sync'
      )),
    );

    expect(SYNCED_SESSION_AUTHORING_FIELD_IDS_V1).toEqual(expect.arrayContaining([
      'directory',
      'machineId',
      'serverId',
      'checkoutCreationDraft',
      'backendTarget',
      'transcriptStorage',
      'profileId',
      'permissionMode',
      'modelId',
      'mcpSelection',
      'connectedServices',
      'terminal',
      'automation',
    ]));
    expect(SYNCED_SESSION_AUTHORING_FIELD_IDS_V1).not.toEqual(expect.arrayContaining([
      'displayText',
      'environmentVariables',
      'prompt',
      'permissionModeUpdatedAt',
      'modelUpdatedAt',
      'connectedServicesUpdatedAt',
      'existingSessionId',
      'sessionEncryptionMode',
      'sessionEncryptionKeyBase64',
      'sessionEncryptionVariant',
      'sessionConfigOptionOverrides',
    ]));

    expect(SyncedSessionAuthoringFieldIdV1Schema.safeParse('directory').success).toBe(true);
    expect(SyncedSessionAuthoringFieldIdV1Schema.safeParse('environmentVariables').success).toBe(false);
    expect(SyncedSessionAuthoringValueV1Schema.shape.directory.safeParse('/tmp/project').success).toBe(true);
    expect(SyncedSessionAuthoringValueV1Schema.shape.directory.safeParse('').success).toBe(false);
    expect(SyncedSessionAuthoringValueV1Schema.shape.terminal.safeParse({
      mode: 'tmux',
      tmux: { sessionName: 'safe', tmpDir: '/private/local/path' },
    }).success).toBe(false);
    expect(SyncedSessionAuthoringValueV1Schema.shape.connectedServices.safeParse({ arbitrary: 'json' }).success).toBe(false);
    expect(SyncedSessionAuthoringValueV1Schema.shape.connectedServices.safeParse({
      v: 1,
      bindingsByServiceId: {
        github: { source: 'connected', profileId: 'profile-1', token: 'must-not-sync' },
      },
    }).success).toBe(false);
  });
});

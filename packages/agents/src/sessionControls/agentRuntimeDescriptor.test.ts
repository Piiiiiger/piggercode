import { describe, expect, it } from 'vitest';

import {
  buildCodexAgentRuntimeDescriptor,
  readSessionMetadataRuntimeDescriptor,
} from './agentRuntimeDescriptor.js';

describe('readSessionMetadataRuntimeDescriptor', () => {
  it('builds a canonical codex runtime descriptor with provider-owned runtime affinity', () => {
    const descriptor = buildCodexAgentRuntimeDescriptor({
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      connectedServiceGroupId: 'main',
      homePath: '/tmp/codex-home',
      sqliteHomePath: '/tmp/codex-state',
    });

    expect(readSessionMetadataRuntimeDescriptor({
      agentRuntimeDescriptorV1: descriptor,
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      connectedServiceGroupId: 'main',
      homePath: '/tmp/codex-home',
      sqliteHomePath: '/tmp/codex-state',
    });
  });

  it('returns codex source affinity from the generic runtime descriptor', () => {
    expect(readSessionMetadataRuntimeDescriptor({
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: {
          backendMode: 'appServer',
          vendorSessionId: 'thread_connected',
          home: 'connectedService',
          connectedServiceId: 'openai-codex',
        },
      },
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: null,
      connectedServiceGroupId: null,
      homePath: null,
      sqliteHomePath: null,
    });
  });

  it('prefers codex providerExtra over legacy provider fields', () => {
    expect(readSessionMetadataRuntimeDescriptor({
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: {
          backendMode: 'appServer',
          vendorSessionId: 'provider-thread',
          home: 'user',
          connectedServiceId: 'provider-service',
          providerExtra: {
            v: 1,
            runtimeAffinity: {
              backendMode: 'acp',
              vendorSessionId: 'extra-thread',
              home: 'connectedService',
              connectedServiceId: 'extra-service',
              connectedServiceProfileId: 'work',
              homePath: '/tmp/codex-home',
            },
          },
        },
      },
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'acp',
      vendorSessionId: 'extra-thread',
      home: 'connectedService',
      connectedServiceId: 'extra-service',
      connectedServiceProfileId: 'work',
      connectedServiceGroupId: null,
      homePath: '/tmp/codex-home',
      sqliteHomePath: null,
    });
  });

  it('normalizes legacy codex backend aliases from generic runtime descriptors', () => {
    expect(readSessionMetadataRuntimeDescriptor({
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: {
          backendMode: '  mcp_resume  ',
          vendorSessionId: 'thread_legacy',
        },
      },
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'acp',
      vendorSessionId: 'thread_legacy',
      home: null,
      connectedServiceId: null,
      connectedServiceProfileId: null,
      connectedServiceGroupId: null,
      homePath: null,
      sqliteHomePath: null,
    });
  });

  it('does not retain stale connected-service fields when the canonical codex home resolves to user', () => {
    expect(readSessionMetadataRuntimeDescriptor({
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: {
          backendMode: 'appServer',
          vendorSessionId: 'thread_connected',
          home: 'user',
          connectedServiceId: 'stale-service',
          connectedServiceProfileId: 'stale-profile',
          homePath: '/tmp/codex-home',
        },
      },
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'user',
      connectedServiceId: null,
      connectedServiceProfileId: null,
      connectedServiceGroupId: null,
      homePath: '/tmp/codex-home',
      sqliteHomePath: null,
    });
  });

});

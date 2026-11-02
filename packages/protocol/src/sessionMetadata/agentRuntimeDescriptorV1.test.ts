import { describe, expect, it } from 'vitest';

import {
  AgentRuntimeDescriptorV1Schema,
  buildCodexAgentRuntimeDescriptorV1,
  readCanonicalAgentRuntimeDescriptorV1ForProvider,
  readAgentRuntimeDescriptorV1ForProvider,
} from './agentRuntimeDescriptorV1';

describe('agentRuntimeDescriptorV1', () => {
  it('parses generic provider envelopes with provider-owned extras', () => {
    expect(AgentRuntimeDescriptorV1Schema.parse({
      v: 1,
      providerId: 'custom-provider',
      provider: {
        backendMode: 'custom-runtime',
        vendorSessionId: 'session_1',
        providerExtra: {
          owner: 'apps/cli',
          schemaId: 'custom-provider.runtimeDescriptor.extra',
          v: 1,
          customFlag: true,
        },
      },
      extra: 'x',
    })).toMatchObject({
      providerId: 'custom-provider',
      provider: {
        backendMode: 'custom-runtime',
        vendorSessionId: 'session_1',
        providerExtra: {
          owner: 'apps/cli',
          schemaId: 'custom-provider.runtimeDescriptor.extra',
          v: 1,
          customFlag: true,
        },
      },
      extra: 'x',
    });
  });

  it('builds and parses a codex descriptor', () => {
    const built = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'appServer',
      vendorSessionId: 'thread_1',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      connectedServiceGroupId: 'main',
      homePath: '/tmp/codex-home',
    });
    expect(AgentRuntimeDescriptorV1Schema.parse({ ...built, extra: 'x' })).toMatchObject({
      providerId: 'codex',
      provider: {
        backendMode: 'appServer',
        vendorSessionId: 'thread_1',
        home: 'connectedService',
        connectedServiceId: 'openai-codex',
        connectedServiceProfileId: 'work',
        connectedServiceGroupId: 'main',
        homePath: '/tmp/codex-home',
        providerExtra: {
          owner: 'codex',
          schemaId: 'codex.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeAffinity: {
            backendMode: 'appServer',
            vendorSessionId: 'thread_1',
            home: 'connectedService',
            connectedServiceId: 'openai-codex',
            connectedServiceProfileId: 'work',
            connectedServiceGroupId: 'main',
            homePath: '/tmp/codex-home',
          },
        },
      },
      extra: 'x',
    });
  });

  it('builds and parses codex source affinity fields', () => {
    const built = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'appServer',
      vendorSessionId: 'thread_connected',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
    });

    expect(AgentRuntimeDescriptorV1Schema.parse(built)).toMatchObject({
      providerId: 'codex',
      provider: {
        backendMode: 'appServer',
        vendorSessionId: 'thread_connected',
        home: 'connectedService',
        connectedServiceId: 'openai-codex',
        providerExtra: {
          owner: 'codex',
          schemaId: 'codex.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeAffinity: {
            backendMode: 'appServer',
            vendorSessionId: 'thread_connected',
            home: 'connectedService',
            connectedServiceId: 'openai-codex',
          },
        },
      },
    });
  });

  it('round-trips codex sqlite affinity and keeps older descriptors compatible', () => {
    const built = buildCodexAgentRuntimeDescriptorV1({
      backendMode: 'appServer',
      vendorSessionId: 'thread_sqlite',
      homePath: '/tmp/codex-home',
      sqliteHomePath: '/tmp/codex-state',
    });

    expect(readCanonicalAgentRuntimeDescriptorV1ForProvider(built, 'codex')).toMatchObject({
      providerId: 'codex',
      vendorSessionId: 'thread_sqlite',
      homePath: '/tmp/codex-home',
      sqliteHomePath: '/tmp/codex-state',
    });
    expect(readCanonicalAgentRuntimeDescriptorV1ForProvider({
      v: 1,
      providerId: 'codex',
      provider: { backendMode: 'appServer' },
    }, 'codex')).toMatchObject({
      sqliteHomePath: null,
    });
  });

  it('normalizes legacy codex backend aliases from provider extras', () => {
    expect(readCanonicalAgentRuntimeDescriptorV1ForProvider({
      v: 1,
      providerId: 'codex',
      provider: {
        backendMode: 'mcp',
        vendorSessionId: 'thread_legacy',
        providerExtra: {
          owner: 'codex',
          schemaId: 'codex.agentRuntimeDescriptorExtra',
          v: 1,
          runtimeAffinity: {
            backendMode: '  mcp_resume  ',
            vendorSessionId: 'thread_runtime',
          },
        },
      },
    }, 'codex')).toEqual({
      providerId: 'codex',
      backendMode: 'acp',
      vendorSessionId: 'thread_runtime',
      home: null,
      connectedServiceId: null,
      connectedServiceProfileId: null,
      connectedServiceGroupId: null,
      homePath: null,
      sqliteHomePath: null,
    });
  });
});

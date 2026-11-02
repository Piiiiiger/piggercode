import { describe, expect, it, vi, beforeEach } from 'vitest';

const forkCodexAppServerConversationNativeMock = vi.fn();

vi.mock('@/backends/codex/appServer/nativeFork', () => ({
  forkCodexAppServerConversationNative: (...args: unknown[]) => forkCodexAppServerConversationNativeMock(...args),
}));

import { dispatchProviderNativeFork } from './providerNativeForkDispatch';

describe('dispatchProviderNativeFork', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches Codex app-server latest-turn conversation forks through the native provider path', async () => {
    forkCodexAppServerConversationNativeMock.mockResolvedValueOnce({ type: 'success', vendorSessionId: 'codex_child_1' });

    const result = await dispatchProviderNativeFork({
      credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array([1]) } },
      agentId: 'codex',
      parentSessionId: 'happy_parent',
      parentRawSession: {},
      parentMetadata: {
        agentRuntimeDescriptorV1: {
          v: 1,
          providerId: 'codex',
          provider: { backendMode: 'appServer', vendorSessionId: 'codex_parent_1', home: 'connectedService', connectedServiceId: 'openai-codex', connectedServiceProfileId: 'work', homePath: '/tmp/connected-codex-home' },
        },
        codexSessionId: 'codex_parent_1',
        codexBackendMode: 'mcp',
      },
      directory: '/tmp/project',
      forkPoint: { type: 'latest' },
      targetSeqInclusive: 17,
    });

    expect(forkCodexAppServerConversationNativeMock).toHaveBeenCalledWith({
      directory: '/tmp/project',
      parentCodexSessionId: 'codex_parent_1',
      processEnv: expect.objectContaining({ CODEX_HOME: '/tmp/connected-codex-home' }),
    });
    expect(result).toMatchObject({
      vendorSessionId: 'codex_child_1',
      spawn: {
        resume: 'codex_child_1',
        codexBackendMode: 'appServer',
        environmentVariables: { CODEX_HOME: '/tmp/connected-codex-home' },
      },
      metadata: {
        codexSessionId: 'codex_child_1',
        codexBackendMode: 'appServer',
        agentRuntimeDescriptorV1: {
          providerId: 'codex',
          provider: {
            backendMode: 'appServer',
            vendorSessionId: 'codex_child_1',
            home: 'connectedService',
            connectedServiceId: 'openai-codex',
            connectedServiceProfileId: 'work',
            providerExtra: {
              runtimeAffinity: {
                backendMode: 'appServer',
                vendorSessionId: 'codex_child_1',
                home: 'connectedService',
                connectedServiceId: 'openai-codex',
                connectedServiceProfileId: 'work',
              },
            },
          },
        },
      },
      providerHint: {
        providerId: 'codex',
        backendMode: 'appServer',
        vendorSessionId: 'codex_child_1',
      },
    });
    expect((result?.metadata.agentRuntimeDescriptorV1 as any)?.provider?.homePath).toBeUndefined();
    expect((result?.metadata.agentRuntimeDescriptorV1 as any)?.provider?.providerExtra?.runtimeAffinity?.homePath).toBeUndefined();
  });

  it('does not expose a Codex native fork for non-app-server or message-point requests', async () => {
    expect(
      await dispatchProviderNativeFork({
        credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array([1]) } },
        agentId: 'codex',
        parentSessionId: 'happy_parent',
        parentRawSession: {},
        parentMetadata: {
          agentRuntimeDescriptorV1: {
            v: 1,
            providerId: 'codex',
            provider: { backendMode: 'mcp', vendorSessionId: 'codex_parent_1' },
          },
          codexSessionId: 'codex_parent_1',
          codexBackendMode: 'appServer',
        },
        directory: '/tmp/project',
        forkPoint: { type: 'latest' },
        targetSeqInclusive: 17,
      }),
    ).toBeNull();

    expect(
      await dispatchProviderNativeFork({
        credentials: { token: 'token', encryption: { type: 'legacy', secret: new Uint8Array([1]) } },
        agentId: 'codex',
        parentSessionId: 'happy_parent',
        parentRawSession: {},
        parentMetadata: {
          codexSessionId: 'codex_parent_1',
          codexBackendMode: 'appServer',
        },
        directory: '/tmp/project',
        forkPoint: { type: 'seq', upToSeqInclusive: 17 },
        targetSeqInclusive: 17,
      }),
    ).toBeNull();
  });
});

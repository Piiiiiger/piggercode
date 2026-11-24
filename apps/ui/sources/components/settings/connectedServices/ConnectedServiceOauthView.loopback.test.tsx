import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeBase64, encodeBase64, sealBoxBundle } from '@piggercode/protocol';
import type { ExpoRouterParams } from '@/dev/testkit/mocks/router';
import { changeTextTestInstance, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installConnectedServicesCommonModuleMocks } from './connectedServicesTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
  searchParams: {} as Record<string, string>,
  routerPushSpy: vi.fn(),
  routerBackSpy: vi.fn(),
  openExternalUrlSpy: vi.fn(async (_url: string) => true),
  storeCredentialSpy: vi.fn(async (_credentials: unknown, _params: unknown) => {}),
  exchangeSpy: vi.fn(),
  // The desktop's native task runner (hsetup): started, listened to and cancelled by the screen.
  runner: {
    start: vi.fn(async (_spec: unknown) => 'task-1'),
    cancel: vi.fn(async (_taskId: string) => {}),
    listeners: [] as Array<{ onEvent?: (event: unknown) => void; onResult?: (result: unknown) => void }>,
  },
}));

installConnectedServicesCommonModuleMocks({
  reactNative: async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
  },
  router: async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const routerMock = createExpoRouterMock({
      router: { back: shared.routerBackSpy, push: shared.routerPushSpy },
    });
    return {
      ...routerMock.module,
      useLocalSearchParams: () => shared.searchParams as ExpoRouterParams,
      useGlobalSearchParams: () => shared.searchParams as ExpoRouterParams,
    };
  },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
  useFeatureEnabled: () => true,
}));

const legacySecretB64Url = Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');
vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({ credentials: { token: 't', secret: legacySecretB64Url } }),
}));

vi.mock('@/utils/platform/tauri', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/platform/tauri')>(),
  isTauriDesktop: () => true,
}));

vi.mock('@/components/systemTasks/systemTasksRuntime', () => ({
  getSystemTasksRunner: () => ({
    mode: 'tauri',
    start: shared.runner.start,
    cancel: shared.runner.cancel,
    respond: async () => {},
    getSnapshot: () => null,
    subscribe: (_taskId: string, onEvent?: (event: unknown) => void, onResult?: (result: unknown) => void) => {
      const listener = { onEvent, onResult };
      shared.runner.listeners.push(listener);
      return () => {
        shared.runner.listeners = shared.runner.listeners.filter((candidate) => candidate !== listener);
      };
    },
  }),
}));

vi.mock('@/utils/url/openExternalUrl', () => ({
  openExternalUrl: shared.openExternalUrlSpy,
}));

vi.mock('@/sync/sync', () => ({
  sync: { refreshProfile: vi.fn(async () => {}) },
}));

vi.mock('@/sync/api/account/apiConnectedServicesV2', () => ({
  exchangeConnectedServiceOauthViaProxy: shared.exchangeSpy,
}));

vi.mock('@/sync/domains/connectedServices/storeConnectedServiceCredentialForAccount', () => ({
  storeConnectedServiceCredentialForAccount: shared.storeCredentialSpy,
  deleteConnectedServiceCredentialForAccount: vi.fn(async () => {}),
}));

vi.mock('@/utils/auth/oauthCore', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/auth/oauthCore')>(),
  generateOauthState: () => 'state-1',
  generatePkceCodes: async () => ({ verifier: 'verifier-1', challenge: 'challenge-1' }),
}));

/** The relay seals the provider's tokens to the key the app sent; this stands in for it. */
async function sealedExchange(_credentials: unknown, params: { serviceId: string; publicKey: string }) {
  const plaintext = new TextEncoder().encode(JSON.stringify({
    serviceId: params.serviceId,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    idToken: null,
    scope: null,
    tokenType: null,
    providerEmail: 'person@example.com',
    providerAccountId: 'acct-1',
    expiresAt: 123,
    raw: {},
  }));
  const bundle = sealBoxBundle({
    plaintext,
    recipientPublicKey: decodeBase64(params.publicKey, 'base64url'),
    randomBytes: (n) => new Uint8Array(n).fill(7),
  });
  return { bundle: encodeBase64(bundle, 'base64url') };
}

const listening = (port: number) => ({
  protocolVersion: 1, taskId: 'task-1', tsMs: 1, type: 'listening', stepId: 'listen', data: { port, addresses: ['127.0.0.1'] },
});
const cameBack = (callbackUrl: string) => ({ protocolVersion: 1, taskId: 'task-1', ok: true, data: { callbackUrl } });
const failed = (code: string) => ({ protocolVersion: 1, taskId: 'task-1', ok: false, error: { code, message: code } });

async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
  }
}

async function deliver(kind: 'event' | 'result', payload: unknown): Promise<void> {
  await act(async () => {
    for (const listener of shared.runner.listeners) {
      if (kind === 'event') listener.onEvent?.(payload);
      else listener.onResult?.(payload);
    }
  });
  await flush();
}

async function openSignIn(params: Record<string, string>): Promise<renderer.ReactTestRenderer> {
  shared.searchParams = params;
  const { ConnectedServiceOauthView } = await import('./ConnectedServiceOauthView');
  const { tree } = await renderScreen(<ConnectedServiceOauthView />);
  await flush();
  return tree;
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props?.testID === testID)[0];
}

describe('ConnectedServiceOauthView on the desktop', () => {
  beforeEach(() => {
    shared.routerPushSpy.mockClear();
    shared.routerBackSpy.mockClear();
    shared.openExternalUrlSpy.mockClear();
    shared.storeCredentialSpy.mockClear();
    shared.exchangeSpy.mockReset();
    shared.exchangeSpy.mockImplementation(sealedExchange);
    shared.runner.start.mockClear();
    shared.runner.cancel.mockClear();
    shared.runner.listeners = [];
  });

  it('opens the system browser with a local redirect and adds the account once the browser comes back', async () => {
    await openSignIn({ serviceId: 'claude-subscription', profileId: 'a', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'connectedServices.oauthCallback.v1',
      params: expect.objectContaining({ port: 0, path: '/callback' }),
    }));

    await deliver('event', listening(53682));
    expect(shared.openExternalUrlSpy).toHaveBeenCalledTimes(1);
    const opened = new URL(shared.openExternalUrlSpy.mock.calls[0]![0]);
    expect(opened.searchParams.get('redirect_uri')).toBe('http://localhost:53682/callback');
    expect(opened.searchParams.get('state')).toBe('state-1');
    expect(opened.searchParams.get('code_challenge')).toBe('challenge-1');

    await deliver('result', cameBack('http://localhost:53682/callback?code=code-1&state=state-1'));
    expect(shared.exchangeSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serviceId: 'claude-subscription',
      code: 'code-1',
      verifier: 'verifier-1',
      redirectUri: 'http://localhost:53682/callback',
      state: 'state-1',
    }));
    expect(shared.storeCredentialSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceId: 'claude-subscription', profileId: 'a' }),
    );
    expect(shared.routerBackSpy).toHaveBeenCalled();
  });

  it('offers the device code when the fixed Codex port is taken', async () => {
    const tree = await openSignIn({ serviceId: 'openai-codex', profileId: 'b', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ port: 1455, path: '/auth/callback' }),
    }));

    await deliver('result', failed('port_in_use'));
    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.oauthLoopback.useDeviceCodeButton')!);
    });
    expect(shared.routerPushSpy).toHaveBeenCalledWith({
      pathname: '/settings/connected-services/oauth',
      params: { serviceId: 'openai-codex', profileId: 'b', method: 'device' },
    });
    expect(shared.exchangeSpy).not.toHaveBeenCalled();
  });

  it('finishes from an address pasted from the browser, and stops listening', async () => {
    const tree = await openSignIn({ serviceId: 'claude-subscription', profileId: 'a', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledTimes(1);
    await deliver('event', listening(53682));

    await act(async () => {
      changeTextTestInstance(
        byTestId(tree, 'connectedServices.oauthLoopback.pasteInput')!,
        'http://localhost:53682/callback?code=code-2&state=state-1',
      );
    });
    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.oauthLoopback.pasteButton')!);
    });
    await flush();

    expect(shared.runner.cancel).toHaveBeenCalledWith('task-1');
    expect(shared.exchangeSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'code-2' }));
    expect(shared.routerBackSpy).toHaveBeenCalled();
  });

  it('keeps waiting for the browser after a paste that answers another sign-in', async () => {
    const tree = await openSignIn({ serviceId: 'claude-subscription', profileId: 'a', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledTimes(1);
    await deliver('event', listening(53682));

    await act(async () => {
      changeTextTestInstance(
        byTestId(tree, 'connectedServices.oauthLoopback.pasteInput')!,
        'http://localhost:53682/callback?code=code-4&state=someone-else',
      );
    });
    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.oauthLoopback.pasteButton')!);
    });
    await flush();
    expect(String(byTestId(tree, 'connectedServices.oauthLoopback.pasteError')?.props.children)).toContain('stateMismatch');
    expect(shared.runner.cancel).not.toHaveBeenCalled();
    expect(shared.exchangeSpy).not.toHaveBeenCalled();

    await deliver('result', cameBack('http://localhost:53682/callback?code=code-5&state=state-1'));
    expect(shared.exchangeSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'code-5' }));
    expect(shared.routerBackSpy).toHaveBeenCalled();
  });

  it('refuses an answer that belongs to another sign-in', async () => {
    const tree = await openSignIn({ serviceId: 'claude-subscription', profileId: 'a', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledTimes(1);
    await deliver('event', listening(53682));
    await deliver('result', cameBack('http://localhost:53682/callback?code=code-3&state=someone-else'));

    expect(shared.exchangeSpy).not.toHaveBeenCalled();
    expect(shared.storeCredentialSpy).not.toHaveBeenCalled();
    expect(String(byTestId(tree, 'connectedServices.oauthLoopback.status')?.props.children)).toContain('stateMismatch');
    expect(byTestId(tree, 'connectedServices.oauthLoopback.retryButton')).toBeDefined();
    // Whatever went wrong here, the manual sign-in stays one press away.
    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.oauthLoopback.usePasteButton')!);
    });
    expect(shared.routerPushSpy).toHaveBeenCalledWith({
      pathname: '/settings/connected-services/oauth',
      params: { serviceId: 'claude-subscription', profileId: 'a', method: 'paste' },
    });
  });

  it('stops listening when the screen closes', async () => {
    const tree = await openSignIn({ serviceId: 'claude-subscription', profileId: 'a', method: 'browser' });
    expect(shared.runner.start).toHaveBeenCalledTimes(1);
    await deliver('event', listening(53682));
    await act(async () => {
      tree.unmount();
    });
    expect(shared.runner.cancel).toHaveBeenCalledWith('task-1');
  });
});

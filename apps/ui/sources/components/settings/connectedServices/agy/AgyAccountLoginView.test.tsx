import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@piggercode/protocol/rpc';
import type { ExpoRouterParams } from '@/dev/testkit/mocks/router';
import { changeTextTestInstance, flushHookEffects, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installConnectedServicesCommonModuleMocks } from '../connectedServicesTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StepCall = Readonly<{ machineId: string; method: string; payload: Readonly<Record<string, unknown>> }>;

const shared = vi.hoisted(() => ({
  params: { machineId: 'vm', machineName: 'build box' } as Record<string, string>,
  routerBackSpy: vi.fn(),
  openExternalUrlSpy: vi.fn(async (_url: string) => true),
  // The machine: what its daemon answers to each step of the sign-in.
  machineRpcSpy: vi.fn(async (_input: StepCall): Promise<unknown> => ({ ok: false, errorCode: 'unset' })),
}));

installConnectedServicesCommonModuleMocks({
  router: async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const routerMock = createExpoRouterMock({ router: { back: shared.routerBackSpy, push: vi.fn() } });
    return {
      ...routerMock.module,
      useLocalSearchParams: () => shared.params as ExpoRouterParams,
      useGlobalSearchParams: () => shared.params as ExpoRouterParams,
    };
  },
});

vi.mock('@/utils/url/openExternalUrl', () => ({
  openExternalUrl: shared.openExternalUrlSpy,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc')>(),
  machineRpcWithServerScope: shared.machineRpcSpy,
}));

const SIGN_IN_URL = 'https://accounts.google.com/o/oauth2/auth?state=s1';

function machineAnswers(answers: Readonly<Record<string, unknown>>): void {
  shared.machineRpcSpy.mockImplementation(async (input) => answers[String(input.payload.action)] ?? { ok: false, errorCode: 'unexpected' });
}

const steps = () => shared.machineRpcSpy.mock.calls.map(([input]) => input.payload);

async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await flushHookEffects({ cycles: 1, turns: 1 });
    });
  }
}

async function openScreen(): Promise<renderer.ReactTestRenderer> {
  const { AgyAccountLoginView } = await import('./AgyAccountLoginView');
  const { tree } = await renderScreen(<AgyAccountLoginView />);
  await flush();
  return tree;
}

function byTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props?.testID === testID)[0];
}

describe('AgyAccountLoginView', () => {
  beforeEach(() => {
    shared.machineRpcSpy.mockReset();
    shared.openExternalUrlSpy.mockClear();
    shared.routerBackSpy.mockClear();
  });

  it('starts agy on the machine, opens Google sign-in here, and signs in with the pasted code', async () => {
    machineAnswers({
      start: { ok: true, action: 'start', loginId: 'l1', accountId: 'a', url: SIGN_IN_URL },
      submit: { ok: true, action: 'submit', accountId: 'a' },
    });
    const tree = await openScreen();
    expect(shared.machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'vm',
      method: RPC_METHODS.DAEMON_AGY_ACCOUNT_LOGIN,
      payload: { action: 'start' },
    }));
    expect(shared.openExternalUrlSpy).toHaveBeenCalledWith(SIGN_IN_URL);

    await act(async () => {
      changeTextTestInstance(byTestId(tree, 'connectedServices.agyLogin.codeInput')!, ' 4/0Abc ');
    });
    await act(async () => {
      const submitButton = byTestId(tree, 'connectedServices.agyLogin.submitButton')!;
      // A double press sends the code once.
      await Promise.all([pressTestInstanceAsync(submitButton), pressTestInstanceAsync(submitButton)]);
    });
    await flush();

    expect(steps()).toEqual([{ action: 'start' }, { action: 'submit', loginId: 'l1', code: '4/0Abc' }]);
    expect(shared.routerBackSpy).toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
    // Signed in: the machine has nothing left to cancel.
    expect(steps()).toHaveLength(2);
  });

  it('says what the machine refused, and starts over on request', async () => {
    machineAnswers({ start: { ok: false, errorCode: 'agy_account_login_requires_encryption' } });
    const tree = await openScreen();

    expect(byTestId(tree, 'connectedServices.agyLogin.status')?.props.children)
      .toBe('connectedServices.agyLogin.errors.requiresEncryption');
    expect(shared.openExternalUrlSpy).not.toHaveBeenCalled();

    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.agyLogin.startOverButton')!);
    });
    await flush();
    expect(steps()).toEqual([{ action: 'start' }, { action: 'start' }]);
  });

  it('keeps the sign-in open after a paste that holds no code, and still cancels it on leaving', async () => {
    machineAnswers({
      start: { ok: true, action: 'start', loginId: 'l1', accountId: 'a', url: SIGN_IN_URL },
      submit: { ok: false, errorCode: 'code_unreadable' },
      cancel: { ok: true, action: 'cancel' },
    });
    const tree = await openScreen();
    await act(async () => {
      changeTextTestInstance(byTestId(tree, 'connectedServices.agyLogin.codeInput')!, 'not a code');
    });
    await act(async () => {
      await pressTestInstanceAsync(byTestId(tree, 'connectedServices.agyLogin.submitButton')!);
    });
    await flush();

    expect(byTestId(tree, 'connectedServices.agyLogin.status')?.props.children).toBe('connectedServices.agyLogin.errors.codeUnreadable');
    expect(byTestId(tree, 'connectedServices.agyLogin.codeInput')).toBeDefined();
    await act(async () => {
      tree.unmount();
    });
    await flush();
    expect(steps()).toEqual([{ action: 'start' }, { action: 'submit', loginId: 'l1', code: 'not a code' }, { action: 'cancel', loginId: 'l1' }]);
  });

  it('cancels the sign-in on the machine when the screen closes before it finished', async () => {
    machineAnswers({
      start: { ok: true, action: 'start', loginId: 'l1', accountId: 'a', url: SIGN_IN_URL },
      cancel: { ok: true, action: 'cancel' },
    });
    const tree = await openScreen();

    await act(async () => {
      tree.unmount();
    });
    await flush();

    expect(steps()).toEqual([{ action: 'start' }, { action: 'cancel', loginId: 'l1' }]);
  });
});

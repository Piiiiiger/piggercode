import React from 'react';
import renderer from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION,
  ConnectedServiceQuotaSnapshotV1Schema,
  ConnectedServicesProviderStateSharingSettingsV1Schema,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import { sealLegacyConnectedServiceQuotaSnapshotFixtureCiphertext } from '@piggercode/protocol/testing/accountScopedCipherFixtures';
import { connectedServicesModuleState, installConnectedServicesCommonModuleMocks } from './connectedServicesTestHelpers';
import type { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import type { getConnectedServiceQuotaSnapshotSealed } from '@/sync/api/account/apiConnectedServicesQuotasV2';
import type { getConnectedServiceQuotaSnapshotPlain } from '@/sync/api/account/apiConnectedServicesQuotasV3';
import { flushHookEffects, renderScreen } from '@/dev/testkit';
import { t } from '@/text';
import { formatLastSeen } from '@/utils/sessions/sessionUtils';


(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { modalConfirmSpy } = vi.hoisted(() => ({
  modalConfirmSpy: vi.fn(async () => true),
}));

installConnectedServicesCommonModuleMocks({
  modal: async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: modalConfirmSpy } }).module;
  },
});

// The provider rows now render the brand mark via `SvgXml`; mock the native svg
// boundary to a host element so the test renderer can mount it (mirrors AccountBlock).
vi.mock('react-native-svg', () => ({
  SvgXml: (props: Record<string, unknown>) => React.createElement('SvgXml', props),
  Svg: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement('Svg', props, props.children),
  Circle: (props: Record<string, unknown>) => React.createElement('Circle', props, null),
}));

const stableCredentials = { token: 't', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') } as const;
vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({ credentials: stableCredentials }),
}));

const useFeatureEnabledSpy = vi.fn((_featureId: string) => true);
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
  useFeatureEnabled: (featureId: string) => useFeatureEnabledSpy(featureId),
}));

function createDefaultSettings() {
  return {
  connectedServicesDefaultProfileByServiceId: { anthropic: 'work' },
  connectedServicesProfileLabelByKey: {},
  connectedServicesQuotaPinnedMeterIdsByKey: { 'anthropic/work': ['weekly'] },
  connectedServicesQuotaSummaryStrategyByKey: {},
  };
}

const useSettingsSpy = vi.fn((): Record<string, unknown> => createDefaultSettings());
const { setSettingMutableSpy } = vi.hoisted(() => ({
  setSettingMutableSpy: vi.fn(),
}));
const { profileState } = vi.hoisted(() => ({
  profileState: { connectedServicesV2: [] as ReadonlyArray<unknown> },
}));
const { machineState, machineRpcSpy } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    machineState: {
      current: [] as ReadonlyArray<unknown>,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      change(machines: ReadonlyArray<unknown>) {
        this.current = machines;
        listeners.forEach((listener) => listener());
      },
    },
    machineRpcSpy: vi.fn(async (_input: { machineId: string; method: string }): Promise<unknown> => ({
      ok: true,
      accounts: [],
    })),
  };
});
const { providerStateSharingSetting } = vi.hoisted(() => ({
  providerStateSharingSetting: {
    current: {
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    },
  },
}));

vi.mock('@/sync/store/hooks', () => ({
  useAllMachines: () => React.useSyncExternalStore(machineState.subscribe, () => machineState.current),
  useProfile: () => profileState,
  useSettings: () => useSettingsSpy(),
  useSetting: (name: string) => (name === 'connectedServicesQuotaPinnedMeterIdsByKey' ? {} : undefined),
  useLocalSetting: () => 1,
  useSettingMutable: (name: string) => [
    name === 'connectedServicesProviderStateSharingSettingsV1'
      ? providerStateSharingSetting.current
      : undefined,
    setSettingMutableSpy,
  ],
}));

const {
  fetchAccountEncryptionModeSpy,
  getConnectedServiceQuotaSnapshotPlainSpy,
  getConnectedServiceQuotaSnapshotSealedSpy,
} = vi.hoisted(() => ({
  fetchAccountEncryptionModeSpy: vi.fn<
    (...args: Parameters<typeof fetchAccountEncryptionMode>) => ReturnType<typeof fetchAccountEncryptionMode>
  >(async () => ({ mode: 'e2ee' as const, updatedAt: 0 })),
  getConnectedServiceQuotaSnapshotPlainSpy: vi.fn<
    (...args: Parameters<typeof getConnectedServiceQuotaSnapshotPlain>) => ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>
  >(async () => null),
  getConnectedServiceQuotaSnapshotSealedSpy: vi.fn<
    (...args: Parameters<typeof getConnectedServiceQuotaSnapshotSealed>) => ReturnType<typeof getConnectedServiceQuotaSnapshotSealed>
  >(async () => null),
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
  fetchAccountEncryptionMode: fetchAccountEncryptionModeSpy,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV2', () => ({
  getConnectedServiceQuotaSnapshotSealed: getConnectedServiceQuotaSnapshotSealedSpy,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV3', () => ({
  getConnectedServiceQuotaSnapshotPlain: getConnectedServiceQuotaSnapshotPlainSpy,
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc')>(),
  machineRpcWithServerScope: machineRpcSpy,
}));

function expectRowSwitchOutsidePressables(row: ReactTestInstance): void {
  const switches = row.findAll((node) => String(node.type) === 'Switch');
  expect(switches).toHaveLength(1);
  let ancestor = switches[0].parent;
  while (ancestor) {
    expect(String(ancestor.type)).not.toBe('Pressable');
    ancestor = ancestor.parent;
  }
}

function findItemWithRightElement(root: ReactTestInstance, testID: string): ReactTestInstance {
  const items = root.findAllByProps({ testID }).filter((node) => node.props.rightElement != null);
  if (items.length !== 1) {
    throw new Error(`Expected one right-element Item for ${testID}, found ${items.length}`);
  }
  return items[0];
}

function getSwitchValueChangeHandler(root: ReactTestInstance, testID: string): (value: boolean) => void {
  const rightElement = findItemWithRightElement(root, testID).props.rightElement;
  if (!React.isValidElement<{ onValueChange?: (value: boolean) => void }>(rightElement)) {
    throw new Error(`Expected ${testID} to render a Switch rightElement`);
  }
  if (typeof rightElement.props.onValueChange !== 'function') {
    throw new Error(`Expected ${testID} Switch rightElement to expose onValueChange`);
  }
  return rightElement.props.onValueChange;
}

describe('ConnectedServicesSettingsView quotas', () => {
  beforeEach(() => {
    machineState.current = [];
    machineRpcSpy.mockReset();
    machineRpcSpy.mockResolvedValue({ ok: true, accounts: [] });
    setSettingMutableSpy.mockClear();
    modalConfirmSpy.mockClear();
    profileState.connectedServicesV2 = [{
      serviceId: 'anthropic',
      profiles: [{ profileId: 'work', status: 'connected', providerEmail: null }],
    }];
    useFeatureEnabledSpy.mockReset();
    useFeatureEnabledSpy.mockReturnValue(true);
    useSettingsSpy.mockReset();
    useSettingsSpy.mockReturnValue(createDefaultSettings());
    fetchAccountEncryptionModeSpy.mockReset();
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
    getConnectedServiceQuotaSnapshotPlainSpy.mockReset();
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(null);
    getConnectedServiceQuotaSnapshotSealedSpy.mockReset();
    getConnectedServiceQuotaSnapshotSealedSpy.mockResolvedValue(null);
    providerStateSharingSetting.current = {
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    };
  });

  it('shows every subscription account with its usage windows on the page', async () => {
    profileState.connectedServicesV2 = [{
      serviceId: 'openai-codex',
      profiles: [
        { profileId: 'a', status: 'connected', providerEmail: null },
        { profileId: 'b', status: 'connected', providerEmail: null },
      ],
    }];
    useSettingsSpy.mockReturnValue({
      connectedServicesDefaultProfileByServiceId: { 'openai-codex': 'a' },
      connectedServicesProfileLabelByKey: {},
      connectedServicesQuotaPinnedMeterIdsByKey: {},
      connectedServicesQuotaSummaryStrategyByKey: {},
    });
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    const meter = (meterId: string, label: string, used: number) => ({
      meterId, label, used, limit: 100, unit: 'count', utilizationPct: null, resetsAt: null, status: 'ok', details: {},
    });
    getConnectedServiceQuotaSnapshotPlainSpy.mockImplementation(async (_credentials, params) => (
      ConnectedServiceQuotaSnapshotV1Schema.parse({
        v: 1,
        serviceId: 'openai-codex',
        profileId: params.profileId,
        fetchedAt: 1,
        staleAfterMs: 30 * 60_000,
        planLabel: 'team',
        accountLabel: null,
        meters: [meter('session', 'Session', 100), meter('weekly', 'Weekly', 16)],
      })
    ));

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 4, turns: 1 });

    for (const profileId of ['a', 'b']) {
      for (const meterId of ['session', 'weekly']) {
        expect(tree.root.findAllByProps({
          testID: `connected-services-index:usage:openai-codex:${profileId}:meter:${meterId}`,
        })).not.toHaveLength(0);
      }
    }
  });

  const meterIds = (tree: renderer.ReactTestRenderer) => tree.root.findAll((node) => (
    typeof node.props?.testID === 'string' && node.props.testID.includes(':meter:')
  ));

  it('lists an API key account with no usage meters and nothing to refresh', async () => {
    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 4, turns: 1 });

    expect(tree.root.findAllByProps({ testID: 'connected-services-index:usage:anthropic:work' })).not.toHaveLength(0);
    expect(meterIds(tree)).toHaveLength(0);
    const refreshAll = tree.root.findAll((node) => (
      node.props?.testID === 'connected-services-index:refresh-all' && typeof node.props.onPress === 'function'
    ));
    expect(refreshAll[0]?.props.disabled).toBe(true);
  });

  it('fits the cards into the width the page measured', async () => {
    profileState.connectedServicesV2 = [{
      serviceId: 'openai-codex',
      profiles: [
        { profileId: 'a', status: 'connected', providerEmail: null },
        { profileId: 'b', status: 'connected', providerEmail: null },
      ],
    }];
    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 4, turns: 1 });
    const measure = async (width: number) => {
      const surface = tree.root.findAll((node) => (
        node.props?.testID === 'connected-services-index:accounts' && typeof node.props.onLayout === 'function'
      ))[0];
      await renderer.act(async () => {
        surface!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } });
      });
    };
    const cellWidth = () => {
      const cell = tree.root.findAll((node) => node.props?.testID === 'connected-services-index:cell:openai-codex:a')[0];
      return [cell?.props.style].flat(Infinity).find((style) => typeof style?.width === 'number')?.width;
    };

    // Two 280-wide cards and their gap need 572: a page a fraction narrower holds one card a row.
    await measure(571.6);
    expect(cellWidth()).toBe(571);
    // A layout pass at no width (the page off screen) leaves the cards as they were.
    await measure(0);
    expect(cellWidth()).toBe(571);
  });

  it('lists a subscription account with no meters while usage reading is off', async () => {
    profileState.connectedServicesV2 = [{
      serviceId: 'openai-codex',
      profiles: [{ profileId: 'a', status: 'connected', providerEmail: null }],
    }];
    useFeatureEnabledSpy.mockImplementation((featureId) => (
      featureId !== 'connectedServices.quotas' && featureId !== 'connectedServices.subscription'
    ));
    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 4, turns: 1 });

    expect(tree.root.findAllByProps({ testID: 'connected-services-index:usage:openai-codex:a' })).not.toHaveLength(0);
    expect(meterIds(tree)).toHaveLength(0);
    expect(getConnectedServiceQuotaSnapshotPlainSpy).not.toHaveBeenCalled();
    expect(getConnectedServiceQuotaSnapshotSealedSpy).not.toHaveBeenCalled();
  });

  it('marks each login with a problem, on its card and in the page summary', async () => {
    profileState.connectedServicesV2 = [{
      serviceId: 'openai-codex',
      profiles: [
        { profileId: 'a', status: 'needs_reauth', providerEmail: null },
        { profileId: 'b', status: 'refresh_failed_retryable', providerEmail: null },
        { profileId: 'c', status: 'connected', providerEmail: null },
      ],
    }];
    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 4, turns: 1 });

    const marks = (profileId: string) => [...new Set(tree.root.findAll((node) => (
      typeof node.props?.testID === 'string'
      && node.props.testID.startsWith(`connected-services-index:usage:openai-codex:${profileId}:attention:variant:`)
    )).map((node) => String(node.props.testID).split(':variant:')[1]))];
    expect([marks('a'), marks('b'), marks('c')]).toEqual([['danger'], ['warning'], []]);
    expect(tree.root.findAllByProps({ testID: 'connected-services-index:meta-attention' })).not.toHaveLength(0);
    expect(tree.root.findAll((node) => String(node.type) === 'SvgXml').length).toBeGreaterThan(0);
  });

  describe('Gemini accounts', () => {
    const MACHINE = { id: 'vm', active: true, metadata: { displayName: 'vm' } };
    const OFFLINE_MACHINE = { id: 'mac', active: false, metadata: { displayName: 'mac' } };
    const account = (accountId: string, email: string, remainingFraction: number) => ({
      accountId,
      email,
      planTier: null,
      observedAtMs: Date.now() - 180_000,
      meters: [
        { meterId: 'gemini-5h', remainingFraction, resetAtMs: Date.now() + 3_600_000 },
        { meterId: 'gemini-weekly', remainingFraction: 0.75, resetAtMs: Date.now() + 86_400_000 },
      ],
    });
    const byTestId = (root: ReactTestInstance, testID: string) => root.findAll((node) => node.props?.testID === testID);
    const withSubtitle = (root: ReactTestInstance, subtitle: string) =>
      root.findAll((node) => node.props?.subtitle === subtitle);
    async function renderPage(): Promise<ReactTestInstance> {
      const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
      const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
      await flushHookEffects({ cycles: 4, turns: 1 });
      return tree.root;
    }
    async function pressRefresh(root: ReactTestInstance, accountId: string): Promise<void> {
      const button = byTestId(root, `connected-services-index:usage:agy:vm:${accountId}:refresh`)
        .find((node) => typeof node.props.onPress === 'function');
      await renderer.act(async () => {
        button!.props.onPress({ stopPropagation: () => {} });
      });
      await flushHookEffects({ cycles: 4, turns: 1 });
    }

    it('shows every account a machine reported, with its limits and when it was seen', async () => {
      machineState.current = [MACHINE];
      const accounts = [account('one', 'one@example.com', 0.25), account('two', 'two@example.com', 1)];
      machineRpcSpy.mockResolvedValue({ ok: true, accounts });
      const root = await renderPage();

      expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
        machineId: 'vm',
        method: RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ,
      }));
      for (const accountId of ['one', 'two']) {
        for (const meterId of ['gemini-5h', 'gemini-weekly']) {
          expect(byTestId(root, `connected-services-index:usage:agy:vm:${accountId}:meter:${meterId}`)).not.toHaveLength(0);
        }
      }
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:meter:gemini-5h')[0]?.props.fillFraction).toBe(0.25);
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:pin:gemini-5h')).toHaveLength(0);
      expect(withSubtitle(root, t('connectedServices.agyUsage.seenOnMachine', {
        machine: 'vm',
        time: formatLastSeen(accounts[0]!.observedAtMs),
      }))).not.toHaveLength(0);
    });

    it('keeps the last reading and says so when the machine stops answering', async () => {
      machineState.current = [MACHINE];
      const accounts = [account('one', 'one@example.com', 0.25)];
      machineRpcSpy.mockResolvedValue({ ok: true, accounts });
      const root = await renderPage();

      await renderer.act(async () => {
        machineState.change([{ ...MACHINE, active: false }]);
      });
      await flushHookEffects({ cycles: 4, turns: 1 });

      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:meter:gemini-5h')).not.toHaveLength(0);
      expect(withSubtitle(root, t('connectedServices.agyUsage.unreachableSeenOnMachine', {
        machine: 'vm',
        time: formatLastSeen(accounts[0]!.observedAtMs),
      }))).not.toHaveLength(0);
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:refresh')).toHaveLength(0);
    });

    it('reads a login with no numbers yet at a press of its refresh button', async () => {
      machineState.current = [MACHINE];
      machineRpcSpy.mockResolvedValue({
        ok: true,
        accounts: [{ accountId: 'b', email: null, planTier: null, observedAtMs: null, meters: [] }],
      });
      const root = await renderPage();
      expect(withSubtitle(root, t('connectedServices.agyUsage.noReadingOnMachine', { machine: 'vm' }))).not.toHaveLength(0);
      expect(machineRpcSpy.mock.calls.some(([input]) => (input as { payload?: { refreshAccountId?: string } }).payload?.refreshAccountId))
        .toBe(false);

      machineRpcSpy.mockResolvedValue({ ok: true, refreshed: true, accounts: [account('b', 'b@example.com', 0.25)] });
      await pressRefresh(root, 'b');

      expect(machineRpcSpy).toHaveBeenCalledWith(expect.objectContaining({
        machineId: 'vm',
        method: RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ,
        payload: { refreshAccountId: 'b' },
      }));
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:b:meter:gemini-5h')[0]?.props.fillFraction).toBe(0.25);
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:b:quota-error')).toHaveLength(0);
    });

    it('offers no read for a login on a machine it cannot reach', async () => {
      machineState.current = [MACHINE];
      machineRpcSpy.mockResolvedValue({
        ok: true,
        accounts: [{ accountId: 'b', email: null, planTier: null, observedAtMs: null, meters: [] }],
      });
      const root = await renderPage();
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:b:refresh')).not.toHaveLength(0);

      await renderer.act(async () => {
        machineState.change([{ ...MACHINE, active: false }]);
      });
      await flushHookEffects({ cycles: 4, turns: 1 });

      expect(byTestId(root, 'connected-services-index:usage:agy:vm:b:refresh')).toHaveLength(0);
      expect(withSubtitle(root, t('connectedServices.agyUsage.unavailableOnMachine', { machine: 'vm' }))).not.toHaveLength(0);
    });

    it('says so when a press could not read the account, and keeps its numbers', async () => {
      machineState.current = [MACHINE];
      const accounts = [account('one', 'one@example.com', 0.25)];
      machineRpcSpy.mockResolvedValue({ ok: true, accounts });
      const root = await renderPage();

      machineRpcSpy.mockResolvedValue({ ok: true, refreshed: false, accounts });
      await pressRefresh(root, 'one');

      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:quota-error')).not.toHaveLength(0);
      expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:meter:gemini-5h')[0]?.props.fillFraction).toBe(0.25);
    });

    it('drops that message once a newer reading arrives, and never shows older numbers again', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        machineState.current = [MACHINE];
        const first = account('one', 'one@example.com', 0.25);
        machineRpcSpy.mockResolvedValue({ ok: true, accounts: [first] });
        const root = await renderPage();
        machineRpcSpy.mockResolvedValue({ ok: true, refreshed: false, accounts: [first] });
        await pressRefresh(root, 'one');

        const newer = { ...account('one', 'one@example.com', 0.5), observedAtMs: first.observedAtMs + 60_000 };
        machineRpcSpy.mockResolvedValue({ ok: true, accounts: [newer] });
        await renderer.act(async () => {
          vi.advanceTimersByTime(30_000);
        });
        await flushHookEffects({ cycles: 4, turns: 1 });
        expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:quota-error')).toHaveLength(0);
        expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:meter:gemini-5h')[0]?.props.fillFraction).toBe(0.5);

        machineRpcSpy.mockResolvedValue({ ok: true, accounts: [first] });
        await renderer.act(async () => {
          vi.advanceTimersByTime(30_000);
        });
        await flushHookEffects({ cycles: 4, turns: 1 });
        expect(byTestId(root, 'connected-services-index:usage:agy:vm:one:meter:gemini-5h')[0]?.props.fillFraction).toBe(0.5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('points to the machine when it has no encryption to send the usage with', async () => {
      machineState.current = [MACHINE];
      machineRpcSpy.mockResolvedValue({ ok: false, errorCode: AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION });
      const root = await renderPage();

      expect(byTestId(root, 'connected-services-index:usage:agy:vm:status')[0]?.props.children)
        .toBe(t('connectedServices.agyUsage.machineNote', {
          machine: 'vm',
          status: t('connectedServices.agyUsage.viewOnMachine'),
        }));
    });

    it('marks a machine it cannot reach as unavailable, beside one that answers', async () => {
      machineState.current = [MACHINE, OFFLINE_MACHINE];
      machineRpcSpy.mockResolvedValue({ ok: true, accounts: [account('one', 'one@example.com', 0.25)] });
      const root = await renderPage();

      expect(byTestId(root, 'connected-services-index:usage:agy:mac:status')[0]?.props.children)
        .toBe(t('connectedServices.agyUsage.machineNote', {
          machine: 'mac',
          status: t('connectedServices.agyUsage.unavailable'),
        }));
      expect(machineRpcSpy.mock.calls.some(([input]) => input.machineId === 'mac')).toBe(false);
    });

    it('keeps reading the machines that answer while another does not', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        machineState.current = [MACHINE, { id: 'stuck', active: true, metadata: { displayName: 'stuck' } }];
        machineRpcSpy.mockImplementation(async ({ machineId }) => {
          if (machineId === 'stuck') return await new Promise<never>(() => {});
          return { ok: true, accounts: [account('one', 'one@example.com', 0.25)] };
        });
        await renderPage();
        const readsOf = (machineId: string) => machineRpcSpy.mock.calls.filter(([input]) => (
          input.machineId === machineId && input.method === RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ
        )).length;
        expect([readsOf('vm'), readsOf('stuck')]).toEqual([1, 1]);

        await renderer.act(async () => {
          vi.advanceTimersByTime(30_000);
        });
        await flushHookEffects({ cycles: 4, turns: 1 });

        expect([readsOf('vm'), readsOf('stuck')]).toEqual([2, 1]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes every account on screen with one press', async () => {
      machineState.current = [MACHINE];
      const accounts = [account('one', 'one@example.com', 0.25), account('two', 'two@example.com', 1)];
      machineRpcSpy.mockResolvedValue({ ok: true, accounts });
      const root = await renderPage();

      machineRpcSpy.mockResolvedValue({ ok: true, refreshed: true, accounts });
      const button = byTestId(root, 'connected-services-index:refresh-all')
        .find((node) => typeof node.props.onPress === 'function');
      await renderer.act(async () => {
        button!.props.onPress();
      });
      await flushHookEffects({ cycles: 4, turns: 1 });

      const pressed = machineRpcSpy.mock.calls
        .map(([input]) => (input as { payload?: { refreshAccountId?: string } }).payload?.refreshAccountId)
        .filter(Boolean)
        .sort();
      expect(pressed).toEqual(['one', 'two']);
    });

    it('offers a Gemini account on a Linux machine whose agy answers, and opens its sign-in there', async () => {
      connectedServicesModuleState.routerPushSpy.mockClear();
      machineRpcSpy.mockResolvedValue({ ok: true, accounts: [account('one', 'one@example.com', 0.25)] });
      machineState.current = [{ id: 'mac', active: true, metadata: { displayName: 'mac', platform: 'darwin' } }];
      const onMac = await renderPage();
      expect(byTestId(onMac, 'connected-services-index:add:agy')).toHaveLength(0);

      // A Linux machine without agy lists no login at all.
      machineRpcSpy.mockResolvedValueOnce({ ok: true, accounts: [] });
      machineState.current = [{ id: 'bare', active: true, metadata: { displayName: 'bare', platform: 'linux' } }];
      const withoutAgy = await renderPage();
      expect(byTestId(withoutAgy, 'connected-services-index:add:agy')).toHaveLength(0);

      machineState.current = [{ id: 'vm', active: true, metadata: { displayName: 'vm', platform: 'linux' } }];
      const onLinux = await renderPage();
      const tile = byTestId(onLinux, 'connected-services-index:add:agy').find((node) => typeof node.props.onPress === 'function');
      expect(tile).toBeDefined();
      await renderer.act(async () => {
        tile!.props.onPress();
      });
      expect(connectedServicesModuleState.routerPushSpy).toHaveBeenCalledWith({
        pathname: '/settings/connected-services/agy-login',
        params: { machineId: 'vm', machineName: 'vm' },
      });
    });

    it('adds no Gemini section while no machine has a reading', async () => {
      machineState.current = [MACHINE, OFFLINE_MACHINE];
      const root = await renderPage();

      expect(root.findAll((node) => (
        typeof node.props?.testID === 'string' && node.props.testID.startsWith('connected-services-index:usage:agy')
      ))).toHaveLength(0);
    });
  });

  it('requires acknowledgement before enabling shared provider state as a global default', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 2, turns: 1 });

    await getSwitchValueChangeHandler(tree.root, 'connected-services-provider-state-sharing-state-default')(true);
    expect(setSettingMutableSpy).toHaveBeenCalledWith({
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'shared' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {
        claude: { sharedStatePrivacy: true },
        codex: { sharedStatePrivacy: true },
      },
    });
    expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the default state-sharing toggle ON without requiring acknowledgement when shared is the default', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);
    // Parsed default after the product change: shared session state is on by default.
    providerStateSharingSetting.current = {
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'shared' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    };

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 2, turns: 1 });

    const stateRow = findItemWithRightElement(tree.root, 'connected-services-provider-state-sharing-state-default');
    const rightElement = stateRow.props.rightElement;
    if (!React.isValidElement<{ value?: boolean }>(rightElement)) {
      throw new Error('Expected default state-sharing row to render a Switch');
    }
    // Default-on must not require an interaction or an acknowledgement modal.
    expect(rightElement.props.value).toBe(true);
    expect(modalConfirmSpy).not.toHaveBeenCalled();
    expect(setSettingMutableSpy).not.toHaveBeenCalled();
  });

  it('surfaces the shared-state privacy note when shared is the active default', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);
    providerStateSharingSetting.current = {
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'shared' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    };

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 2, turns: 1 });

    const note = tree.root.findAll(
      (n) => n.props?.testID === 'connected-services-provider-state-sharing-privacy-note',
    );
    expect(note.length).toBeGreaterThan(0);
  });

  it('persists the isolated opt-out when the global default toggle is turned off', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);
    providerStateSharingSetting.current = {
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'shared' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    };

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);
    await flushHookEffects({ cycles: 2, turns: 1 });

    await getSwitchValueChangeHandler(tree.root, 'connected-services-provider-state-sharing-state-default')(false);
    // Turning the default off is the opt-out: it persists isolated and never prompts.
    expect(setSettingMutableSpy).toHaveBeenCalledWith({
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    });
    expect(modalConfirmSpy).not.toHaveBeenCalled();
  });

  it('selects copied provider config sharing as a distinct mode', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);
    providerStateSharingSetting.current = {
      v: 1,
      defaults: { configMode: 'copied', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    };

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);

    const configModeControl = tree.root.findAllByProps({ selectedId: 'copied' }).find(
      (node) => node.props.itemTrigger?.itemProps?.testID === 'connected-services-provider-state-sharing-config-default',
    );
    expect(configModeControl).toBeDefined();
    if (!configModeControl) throw new Error('Missing global provider config mode control');
    configModeControl.props.onSelect('isolated');

    expect(setSettingMutableSpy).toHaveBeenCalledWith({
      v: 1,
      defaults: { configMode: 'isolated', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    });

    configModeControl.props.onSelect('linked');
    expect(setSettingMutableSpy).toHaveBeenCalledWith({
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'isolated' },
      byAgentId: {},
      acknowledgedRisksByAgentId: {},
    });
  });

  it('renders provider state sharing rows from agent capabilities', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');

    const { tree } = await renderScreen(<ConnectedServicesSettingsView />);

    expect(tree.root.findByProps({ testID: 'connected-services-provider-state-sharing-backend-overrides' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'connected-services-provider-state-sharing-agent-codex-state' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'connected-services-provider-state-sharing-agent-pi-state' })).toHaveLength(0);
  });

  it('keeps provider state sharing switches outside row pressables on web', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);

    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    const { ConnectedServicesProviderStateSharingBackendGroups } = await import('./ConnectedServicesProviderStateSharingSettings');

    // Mount the real Switch after its Deferred clock boundary settles.
    vi.useFakeTimers();
    try {
      const { tree: settingsTree } = await renderScreen(<ConnectedServicesSettingsView />);
      await flushHookEffects({ cycles: 2, turns: 1, runOnlyPendingTimers: true });
      const defaultStateRow = findItemWithRightElement(
        settingsTree.root,
        'connected-services-provider-state-sharing-state-default',
      );
      expectRowSwitchOutsidePressables(defaultStateRow);
      expect(defaultStateRow.props.mode).toBe('info');
      expect(defaultStateRow.props.onPress).toBeUndefined();

      const { tree: backendTree } = await renderScreen(
        <ConnectedServicesProviderStateSharingBackendGroups
          settings={ConnectedServicesProviderStateSharingSettingsV1Schema.parse(providerStateSharingSetting.current)}
          setSettings={setSettingMutableSpy}
          agentIds={['codex']}
        />,
      );
      await flushHookEffects({ cycles: 2, turns: 1, runOnlyPendingTimers: true });
      const backendStateRow = findItemWithRightElement(
        backendTree.root,
        'connected-services-provider-state-sharing-agent-codex-state',
      );
      expectRowSwitchOutsidePressables(backendStateRow);
      expect(backendStateRow.props.mode).toBe('info');
      expect(backendStateRow.props.onPress).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes provider state sharing overrides by agent id', async () => {
    useFeatureEnabledSpy.mockReturnValue(true);

    const { ConnectedServicesProviderStateSharingBackendGroups } = await import('./ConnectedServicesProviderStateSharingSettings');

    const { tree } = await renderScreen(
      <ConnectedServicesProviderStateSharingBackendGroups
        settings={ConnectedServicesProviderStateSharingSettingsV1Schema.parse(providerStateSharingSetting.current)}
        setSettings={setSettingMutableSpy}
        agentIds={['codex']}
      />,
    );
    await flushHookEffects({ cycles: 2, turns: 1 });

    await getSwitchValueChangeHandler(tree.root, 'connected-services-provider-state-sharing-agent-codex-state')(true);

    expect(setSettingMutableSpy).toHaveBeenCalledWith({
      v: 1,
      defaults: { configMode: 'linked', stateMode: 'isolated' },
      byAgentId: {
        codex: { stateMode: 'shared' },
      },
      acknowledgedRisksByAgentId: {
        codex: { sharedStatePrivacy: true },
      },
    });
    expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
  });

  it('does not render provider-state-sharing controls when connectedServices is disabled', async () => {
    useFeatureEnabledSpy.mockReturnValue(false);

    const { ConnectedServicesProviderStateSharingSettingsView } = await import('./ConnectedServicesProviderStateSharingSettings');
    const { tree } = await renderScreen(<ConnectedServicesProviderStateSharingSettingsView />);

    expect(tree.toJSON()).toBeNull();
  });
});

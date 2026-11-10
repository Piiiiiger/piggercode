import { vi } from 'vitest';

type SessionScreenModuleFactory = () => unknown | Promise<unknown>;
type SessionScreenImportOriginal = <T = unknown>() => Promise<T>;
type SessionScreenStorageModuleFactory = (
    importOriginal: SessionScreenImportOriginal,
) => unknown | Promise<unknown>;

type InstallSessionScreenCommonModuleMocksOptions = Readonly<{
    legendList?: SessionScreenModuleFactory;
    modal?: SessionScreenModuleFactory;
    reactNative?: SessionScreenModuleFactory;
    storage?: SessionScreenStorageModuleFactory;
    text?: SessionScreenModuleFactory;
    unistyles?: SessionScreenModuleFactory;
}>;

const sessionScreenModuleState = vi.hoisted(() => ({
    modalMockRef: { current: null as any },
    options: {
        modal: undefined as SessionScreenModuleFactory | undefined,
        legendList: undefined as SessionScreenModuleFactory | undefined,
        reactNative: undefined as SessionScreenModuleFactory | undefined,
        storage: undefined as SessionScreenStorageModuleFactory | undefined,
        text: undefined as SessionScreenModuleFactory | undefined,
        unistyles: undefined as SessionScreenModuleFactory | undefined,
    },
}));
const createReanimatedMock = vi.hoisted(() => async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

export function getSessionScreenModalMockRef() {
    return sessionScreenModuleState.modalMockRef as { current: any };
}

export function resetSessionScreenCommonModuleMockState() {
    sessionScreenModuleState.modalMockRef.current = null;
}

export function installReanimatedModuleMocks() {
    vi.mock('react-native-reanimated', createReanimatedMock);
    vi.mock('react-native-reanimated/lib/module', createReanimatedMock);
    vi.mock('react-native-reanimated/lib/module/index', createReanimatedMock);
    vi.mock('react-native-reanimated/lib/module/index.js', createReanimatedMock);
    vi.mock('react-native-reanimated/lib/module/publicGlobals', createReanimatedMock);
    vi.mock('react-native-reanimated/lib/module/publicGlobals.js', createReanimatedMock);
}

export function installSessionScreenCommonModuleMocks(
    options: InstallSessionScreenCommonModuleMocksOptions = {},
) {
    installReanimatedModuleMocks();

    sessionScreenModuleState.options = {
        modal: options.modal,
        legendList: options.legendList,
        reactNative: options.reactNative,
        storage: options.storage,
        text: options.text,
        unistyles: options.unistyles,
    };

    vi.mock('react-native', async () => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.reactNative) {
            return await activeOptions.reactNative();
        }

        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock();
    });

    vi.mock('@legendapp/list/react-native', async () => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.legendList) {
            return await activeOptions.legendList();
        }
        const { createCapturingLegendListMock } = await import('@/dev/testkit/mocks/legendList');
        return createCapturingLegendListMock().module;
    });

    // ChatListInternal reads session-screen navigation focus for the S-E reveal
    // revalidation; keep the session screen suites navigation-context-free.
    vi.mock('@/components/sessions/shell/useSessionScreenIsFocused', () => ({
        useSessionScreenIsFocused: () => true,
    }));

    vi.mock('react-native-unistyles', async () => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.unistyles) {
            return await activeOptions.unistyles();
        }

        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock();
    });

    vi.mock('@/text', async () => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.text) {
            return await activeOptions.text();
        }

        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    });

    vi.mock('@/modal', async () => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.modal) {
            return await activeOptions.modal();
        }

        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        const modalMock = createModalModuleMock();
        sessionScreenModuleState.modalMockRef.current = modalMock;
        return modalMock.module;
    });

    vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const activeOptions = sessionScreenModuleState.options;
        if (activeOptions.storage) {
            return await activeOptions.storage(importOriginal);
        }

        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {});
    });
}

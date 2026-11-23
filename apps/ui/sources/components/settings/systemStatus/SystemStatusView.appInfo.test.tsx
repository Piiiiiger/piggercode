import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UPDATES_ROUTE } from '@/components/updates/updatesRoute';
import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storageStore';

const nativeApp = vi.hoisted(() => ({
    version: null as string | null,
    build: null as string | null,
    id: null as string | null,
}));
const routerPush = vi.hoisted(() => vi.fn());
const clipboardWrite = vi.hoisted(() => vi.fn(async (_value: string) => true));

vi.mock('expo-clipboard', () => ({ setStringAsync: clipboardWrite, getStringAsync: vi.fn(async () => '') }));
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock({
    router: { push: routerPush, back: vi.fn(), replace: vi.fn(), setParams: vi.fn() },
}).module);
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({ translate: (key) => key }));
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);
vi.mock('expo-application', () => ({
    get nativeApplicationVersion() {
        return nativeApp.version;
    },
    get nativeBuildVersion() {
        return nativeApp.build;
    },
    get applicationId() {
        return nativeApp.id;
    },
}));
vi.mock('expo-updates', () => ({
    isEnabled: false,
    updateId: null,
    createdAt: null,
    channel: null,
    runtimeVersion: null,
    isEmbeddedLaunch: false,
    useUpdates: () => ({}),
}));

const NATIVE_VERSION = 'systemStatus.application.nativeVersion';
const BUILD_NUMBER = 'systemStatus.application.buildNumber';
const APPLICATION_ID = 'systemStatus.application.applicationId';
// This app has no over-the-air updates, so the page has nothing to say about them.
const OTA_ROWS = [
    'systemStatus.application.updateChannel',
    'systemStatus.application.updateId',
    'systemStatus.application.runtimeVersion',
    'systemStatus.application.updateCreatedAt',
    'systemStatus.application.launchSource',
    'systemStatus.updates.otaStatus',
    'systemStatus.updates.lastChecked',
];

type Screen = Awaited<ReturnType<typeof renderScreen>>;

async function renderSystemStatus(): Promise<Screen> {
    upsertAndActivateServer({ serverUrl: 'https://relay.example.com/' });
    const { SystemStatusView } = await import('./SystemStatusView');
    const screen = await renderScreen(<SystemStatusView />);
    await flushHookEffects();
    return screen;
}

function rowsTitled(screen: Screen, title: string) {
    return screen.findAllByProps({ title });
}

function rowDetail(screen: Screen, title: string): unknown {
    return rowsTitled(screen, title)[0]?.props.detail;
}

function expectNoOtaRows(screen: Screen) {
    for (const title of OTA_ROWS) {
        expect(rowsTitled(screen, title), title).toHaveLength(0);
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    routerPush.mockClear();
    clipboardWrite.mockClear();
    nativeApp.version = null;
    nativeApp.build = null;
    nativeApp.id = null;
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
});

describe('SystemStatusView app details', () => {
    it('in a browser, has no row for what a browser cannot know and still leads to Updates', async () => {
        const screen = await renderSystemStatus();

        expect(rowsTitled(screen, 'systemStatus.application.appVersion').length).toBeGreaterThan(0);
        for (const title of [NATIVE_VERSION, BUILD_NUMBER, APPLICATION_ID]) {
            expect(rowsTitled(screen, title), title).toHaveLength(0);
        }
        expectNoOtaRows(screen);

        screen.pressByTestId('system-status-open-updates');
        expect(routerPush).toHaveBeenCalledWith(UPDATES_ROUTE);
    });

    it('in a native app, shows its version, build number and id', async () => {
        nativeApp.version = '1.2.3';
        nativeApp.build = '45';
        nativeApp.id = 'dev.piggercode.native';

        const screen = await renderSystemStatus();

        expect(rowDetail(screen, NATIVE_VERSION)).toBe('1.2.3');
        expect(rowDetail(screen, BUILD_NUMBER)).toBe('45');
        expect(rowDetail(screen, APPLICATION_ID)).toBe('dev.piggercode.native');
        expectNoOtaRows(screen);
    });

    it('in the desktop app, shows and copies the version and identifier the shell reports', async () => {
        const answers: Record<string, string> = {
            'plugin:app|version': '9.8.7',
            'plugin:app|identifier': 'dev.piggercode.desktop',
        };
        vi.stubGlobal('__TAURI_INTERNALS__', {
            invoke: vi.fn(async (command: string) => answers[command] ?? null),
        });

        const screen = await renderSystemStatus();

        expect(rowDetail(screen, NATIVE_VERSION)).toBe('9.8.7');
        expect(rowDetail(screen, APPLICATION_ID)).toBe('dev.piggercode.desktop');
        expect(rowsTitled(screen, BUILD_NUMBER)).toHaveLength(0);
        expectNoOtaRows(screen);

        await screen.pressByTestIdAsync('system-status-copy-json');
        await flushHookEffects();
        expect(JSON.parse(clipboardWrite.mock.calls[0]?.[0] ?? '{}').environment).toMatchObject({
            nativeApplicationVersion: '9.8.7',
            applicationId: 'dev.piggercode.desktop',
        });
    });

    it('leaves the rows out and reports it when the desktop shell cannot answer', async () => {
        const failure = new Error('not allowed');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal('__TAURI_INTERNALS__', {
            invoke: vi.fn(async (command: string) => {
                if (command.startsWith('plugin:app|')) throw failure;
                return null;
            }),
        });

        const screen = await renderSystemStatus();

        expect(rowsTitled(screen, NATIVE_VERSION)).toHaveLength(0);
        expect(rowsTitled(screen, APPLICATION_ID)).toHaveLength(0);
        expect(consoleError.mock.calls.flat()).toContain(failure);
    });
});

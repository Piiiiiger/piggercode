import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PackageUpdaterStore } from '@/updates/packageUpdater';

/**
 * The Android app's update, through its boundaries: the release's `latest.json` (network), the app's cache folder
 * (file system), Android's installer (an intent), the installed version, the app coming to the foreground and the
 * device's key-value store. The lifecycle above them is the real one.
 */
const device = vi.hoisted(() => ({
    version: '0.3.39' as string | null,
    feed: null as unknown,
    feedStatus: 200,
    feedRequests: 0,
    /** The bytes the server sends for the APK (less than the feed's size: a cut-off download). */
    servedSize: 0,
    files: new Map<string, number>(),
    installerCalls: [] as Array<{ action: string; params: Record<string, unknown> }>,
    foregroundListeners: [] as Array<(state: string) => void>,
    kv: new Map<string, string>(),
    /** Held open until released: a check whose answer is still on its way. */
    feedGate: null as Promise<void> | null,
    /** Held open until released: a download still under way (its file exists, still growing). */
    downloadGate: null as Promise<void> | null,
    /** The connection breaks off after part of the APK arrived. */
    downloadError: null as Error | null,
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'android' },
    AppState: {
        addEventListener: (_type: string, listener: (state: string) => void) => {
            device.foregroundListeners.push(listener);
            return { remove: () => {} };
        },
    },
}));

vi.mock('expo-application', () => ({
    get nativeApplicationVersion() {
        return device.version;
    },
}));

const CACHE = 'file:///data/user/0/dev.piggercode.app/cache/';

vi.mock('expo-file-system/legacy', () => ({
    cacheDirectory: CACHE,
    getInfoAsync: async (uri: string) => {
        if (device.files.has(uri)) return { exists: true, isDirectory: false, size: device.files.get(uri), uri };
        const isDir = [...device.files.keys()].some((path) => path.startsWith(uri.endsWith('/') ? uri : `${uri}/`));
        return isDir ? { exists: true, isDirectory: true, uri } : { exists: false, isDirectory: false, uri };
    },
    readDirectoryAsync: async (uri: string) =>
        [...device.files.keys()].filter((path) => path.startsWith(uri)).map((path) => path.slice(uri.length)),
    makeDirectoryAsync: async () => {},
    deleteAsync: async (uri: string) => {
        device.files.delete(uri);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
        const size = device.files.get(from);
        device.files.delete(from);
        if (size !== undefined) device.files.set(to, size);
    },
    createDownloadResumable: (_url: string, fileUri: string, _options: unknown, onProgress: (progress: unknown) => void) => ({
        downloadAsync: async () => {
            // The file exists from the first bytes on; one deleted meanwhile stays deleted.
            device.files.set(fileUri, 0);
            if (device.downloadGate) await device.downloadGate;
            onProgress({ totalBytesWritten: device.servedSize / 2, totalBytesExpectedToWrite: device.servedSize });
            if (device.files.has(fileUri)) device.files.set(fileUri, device.downloadError ? device.servedSize / 2 : device.servedSize);
            if (device.downloadError) throw device.downloadError;
            return { status: 200, uri: fileUri };
        },
    }),
    getContentUriAsync: async (uri: string) =>
        `content://dev.piggercode.app.FileSystemFileProvider/cached_expo_files/${uri.slice(CACHE.length)}`,
}));

vi.mock('expo-intent-launcher', () => ({
    startActivityAsync: async (action: string, params: Record<string, unknown>) => {
        device.installerCalls.push({ action, params });
        // The person closed the installer without updating.
        return { resultCode: 0 };
    },
}));

vi.mock('react-native-mmkv', () => ({
    MMKV: class {
        getString(key: string) {
            return device.kv.get(key);
        }
        set(key: string, value: string) {
            device.kv.set(key, value);
        }
    },
}));

const APK_SIZE = 172_185_897;
const APK_URL = 'https://github.com/Piiiiiger/piggercode/releases/download/ui-android-stable/piggercode-0.3.40-android-arm64.apk';
const UPDATES = `${CACHE}app-updates/`;

function publish(version: string) {
    device.feed = {
        version,
        url: `https://github.com/Piiiiiger/piggercode/releases/download/ui-android-stable/piggercode-${version}-android-arm64.apk`,
        size: APK_SIZE,
    };
    device.servedSize = APK_SIZE;
}

/** Lets every pending step of the lifecycle run (only `Date` is faked). */
async function settle() {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function newStore(): Promise<PackageUpdaterStore> {
    const { createAndroidApkUpdaterStore } = await import('./androidApkUpdater.android');
    const store = createAndroidApkUpdaterStore();
    store.subscribe(() => {});
    await settle();
    return store;
}

describe('Android app update (the APK on the Android release)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-14T08:00:00Z'));
        (globalThis as { __DEV__?: boolean }).__DEV__ = false;
        device.version = '0.3.39';
        device.feed = null;
        device.feedStatus = 200;
        device.feedRequests = 0;
        device.files.clear();
        device.installerCalls.length = 0;
        device.foregroundListeners.length = 0;
        device.kv.clear();
        device.feedGate = null;
        device.downloadGate = null;
        device.downloadError = null;
        vi.stubGlobal('fetch', async (url: string) => {
            device.feedRequests += 1;
            if (device.feedGate) await device.feedGate;
            expect(url).toContain('https://github.com/Piiiiiger/piggercode/releases/download/ui-android-stable/latest.json');
            return { ok: device.feedStatus === 200, status: device.feedStatus, json: async () => device.feed };
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('offers the version the Android release publishes when it is newer, and nothing when this app is current', async () => {
        publish('0.3.40');
        const store = await newStore();
        expect(store.getSnapshot()).toMatchObject({ phase: 'available', version: '0.3.40', currentVersion: '0.3.39' });

        publish('0.3.39');
        await store.check({ force: true });
        expect(store.getSnapshot().phase).toBe('upToDate');
    });

    it('says it could not check when the release has no readable version', async () => {
        device.feed = { version: 'not-a-version' };
        const store = await newStore();
        expect(store.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'check' });
    });

    it("downloads the APK into the app's cache, then opens Android's installer and is ready again when it closes", async () => {
        publish('0.3.40');
        const store = await newStore();
        const percents: Array<number | null> = [];
        store.subscribe(() => percents.push(store.getSnapshot().downloadPercent));

        await store.download();
        expect(percents).toContain(50);
        expect(store.getSnapshot().phase).toBe('ready');
        expect(device.files.get(`${UPDATES}piggercode-0.3.40.apk`)).toBe(APK_SIZE);

        await store.install();
        expect(device.installerCalls).toEqual([{
            action: 'android.intent.action.VIEW',
            params: {
                data: 'content://dev.piggercode.app.FileSystemFileProvider/cached_expo_files/app-updates/piggercode-0.3.40.apk',
                type: 'application/vnd.android.package-archive',
                // FLAG_GRANT_READ_URI_PERMISSION: the installer may read the APK.
                flags: 1,
            },
        }]);
        expect(store.getSnapshot().phase).toBe('ready');
    });

    it('refuses a cut-off download and keeps nothing of it', async () => {
        publish('0.3.40');
        device.servedSize = APK_SIZE - 1;
        const store = await newStore();

        await store.download();
        expect(store.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'download' });
        expect([...device.files.keys()]).toEqual([]);
    });

    it('keeps nothing of a download whose connection broke off', async () => {
        publish('0.3.40');
        device.downloadError = new Error('connection reset');
        const store = await newStore();

        await store.download();
        expect(store.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'download' });
        expect([...device.files.keys()]).toEqual([]);
    });

    it('a check that finishes while the APK downloads leaves that download alone', async () => {
        publish('0.3.40');
        const store = await newStore();

        let answerCheck = () => {};
        device.feedGate = new Promise<void>((resolve) => { answerCheck = resolve; });
        const checking = store.check({ force: true });
        let finishDownload = () => {};
        device.downloadGate = new Promise<void>((resolve) => { finishDownload = resolve; });
        const downloading = store.download();
        await settle();

        answerCheck();
        await checking;
        finishDownload();
        await downloading;

        expect(store.getSnapshot().phase).toBe('ready');
        expect(device.files.get(`${UPDATES}piggercode-0.3.40.apk`)).toBe(APK_SIZE);
    });

    it('is ready at once when that version was downloaded before, and removes downloads of other versions', async () => {
        publish('0.3.40');
        device.files.set(`${UPDATES}piggercode-0.3.40.apk`, APK_SIZE);
        device.files.set(`${UPDATES}piggercode-0.3.39.apk`, APK_SIZE);
        const store = await newStore();

        expect(store.getSnapshot()).toMatchObject({ phase: 'ready', version: '0.3.40' });
        expect([...device.files.keys()]).toEqual([`${UPDATES}piggercode-0.3.40.apk`]);

        // Updated: the installed version's APK is no longer needed.
        device.version = '0.3.40';
        await store.check({ force: true });
        expect(store.getSnapshot().phase).toBe('upToDate');
        expect([...device.files.keys()]).toEqual([]);
    });

    it('checks again when the app comes to the foreground, once the last answer is a day old', async () => {
        publish('0.3.39');
        await newStore();
        expect(device.feedRequests).toBe(1);

        device.foregroundListeners.forEach((listener) => listener('active'));
        await settle();
        expect(device.feedRequests).toBe(1);

        vi.setSystemTime(new Date('2026-11-15T08:01:00Z'));
        device.foregroundListeners.forEach((listener) => listener('active'));
        await settle();
        expect(device.feedRequests).toBe(2);
    });

    it('remembers a skipped version across launches', async () => {
        publish('0.3.40');
        const first = await newStore();
        first.skipVersion();

        const second = await newStore();
        expect(second.getSnapshot()).toMatchObject({ phase: 'available', version: '0.3.40', skipped: true });
    });

    it('stays idle in a development bundle', async () => {
        (globalThis as { __DEV__?: boolean }).__DEV__ = true;
        publish('0.3.40');
        const store = await newStore();
        expect(store.getSnapshot().phase).toBe('idle');
        expect(device.feedRequests).toBe(0);
    });
});

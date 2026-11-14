import { describe, expect, it } from 'vitest';

import type { PackageUpdaterSnapshot } from '@/updates/packageUpdater';

import { buildAppUpdateItem, type AppUpdateFacts } from './buildAppUpdateItem';
import { buildUpdatesSummary } from './buildUpdatesSummary';

const PACKAGE_IDLE: PackageUpdaterSnapshot = {
    phase: 'idle',
    version: null,
    currentVersion: null,
    downloadPercent: null,
    failure: null,
    skipped: false,
    refreshing: false,
    checkedAt: null,
};

function facts(overrides: Partial<AppUpdateFacts> = {}): AppUpdateFacts {
    return {
        platformOs: 'web',
        packageUpdates: null,
        title: 'Happier',
        native: { updateUrl: null, required: false },
        webUiUpdateAvailable: false,
        packageUpdate: PACKAGE_IDLE,
        ota: { isDownloading: false, downloadProgress: null, isUpdatePending: false },
        ...overrides,
    };
}

describe('buildAppUpdateItem (the "This app" row)', () => {
    it('walks the desktop lifecycle: available → downloading with a real percent → ready to restart', () => {
        const available = buildAppUpdateItem(facts({ platformOs: 'macos', packageUpdate: { ...PACKAGE_IDLE, phase: 'available', version: '0.2.11', currentVersion: '0.2.10' } }));
        expect(available).toMatchObject({ channel: 'package', item: { state: 'available', latestVersion: '0.2.11', currentVersion: '0.2.10', action: { kind: 'run', verb: 'update' } } });

        const downloading = buildAppUpdateItem(facts({ packageUpdate: { ...PACKAGE_IDLE, phase: 'downloading', version: '0.2.11', downloadPercent: 42 } }));
        expect(downloading.item).toMatchObject({ state: 'running', step: 'downloading', progressPercent: 42, action: { kind: 'none' } });

        const ready = buildAppUpdateItem(facts({ packageUpdate: { ...PACKAGE_IDLE, phase: 'ready', version: '0.2.11' } }));
        expect(ready.item).toMatchObject({ state: 'ready', action: { kind: 'run', verb: 'restart' } });
    });

    it('the Android app downloads the APK, then installs it through Android\'s installer (Install, not Restart)', () => {
        const android = { platformOs: 'android', packageUpdates: 'android' } as const;
        const available = buildAppUpdateItem(facts({ ...android, packageUpdate: { ...PACKAGE_IDLE, phase: 'available', version: '0.3.40', currentVersion: '0.3.39' } }));
        expect(available).toMatchObject({ channel: 'package', item: { state: 'available', latestVersion: '0.3.40', action: { kind: 'run', verb: 'update' } } });

        const ready = buildAppUpdateItem(facts({ ...android, packageUpdate: { ...PACKAGE_IDLE, phase: 'ready', version: '0.3.40' } }));
        expect(ready.item).toMatchObject({ state: 'ready', action: { kind: 'run', verb: 'install' } });

        const installing = buildAppUpdateItem(facts({ ...android, packageUpdate: { ...PACKAGE_IDLE, phase: 'installing', version: '0.3.40' } }));
        expect(installing.item).toMatchObject({ state: 'running', step: 'installing' });
    });

    it('a failed first check is "could not check" with Retry, never "up to date"', () => {
        const model = buildAppUpdateItem(facts({ packageUpdate: { ...PACKAGE_IDLE, phase: 'failed', failure: 'check' } }));
        expect(model.item).toMatchObject({ state: 'unknown', failure: { kind: 'appCheck' }, action: { kind: 'run', verb: 'retry' } });

        const download = buildAppUpdateItem(facts({ packageUpdate: { ...PACKAGE_IDLE, phase: 'failed', failure: 'download', version: '0.2.11' } }));
        expect(download.item).toMatchObject({ state: 'failed', failure: { kind: 'appDownload' }, action: { kind: 'run', verb: 'retry' } });
    });

    it('keeps a skipped desktop version visible to the row but marked skipped', () => {
        const model = buildAppUpdateItem(facts({ packageUpdate: { ...PACKAGE_IDLE, phase: 'available', version: '0.2.11', skipped: true } }));
        expect(model.item).toMatchObject({ state: 'available', skipped: true });
    });

    it('a required store update outranks everything; web offers Reload; OTA rests at restart', () => {
        expect(buildAppUpdateItem(facts({
            platformOs: 'ios',
            native: { updateUrl: 'https://apps.apple.com/x', required: true },
            packageUpdate: { ...PACKAGE_IDLE, phase: 'available', version: '9' },
        })).item).toMatchObject({ state: 'required', action: { kind: 'run', verb: 'store' } });

        expect(buildAppUpdateItem(facts({ webUiUpdateAvailable: true })).item).toMatchObject({ state: 'available', action: { kind: 'run', verb: 'reload' } });

        expect(buildAppUpdateItem(facts({ platformOs: 'android', ota: { isDownloading: true, downloadProgress: 0.5, isUpdatePending: false } })).item)
            .toMatchObject({ state: 'running', progressPercent: 50 });
        expect(buildAppUpdateItem(facts({ platformOs: 'android', ota: { isDownloading: false, downloadProgress: null, isUpdatePending: true } })).item)
            .toMatchObject({ state: 'ready', action: { kind: 'run', verb: 'restart' } });
    });

    it('with nothing to do the app is up to date (release notes are not an input)', () => {
        expect(buildAppUpdateItem(facts()).item).toMatchObject({ state: 'upToDate', action: { kind: 'none' } });
    });

    it('an idle desktop check is not proof the app is current, including when it is the only row', () => {
        const model = buildAppUpdateItem({ ...facts(), packageUpdates: 'desktop' });
        expect(model).toMatchObject({ channel: 'package', item: { state: 'unchecked', action: { kind: 'none' } } });
        expect(buildUpdatesSummary([model.item])).toMatchObject({ status: 'unchecked', actionableCount: 0 });
        const checked = buildAppUpdateItem({ ...facts(), packageUpdates: 'desktop', packageUpdate: { ...PACKAGE_IDLE, phase: 'upToDate', checkedAt: 1 } });
        expect(buildUpdatesSummary([checked.item])).toMatchObject({ status: 'upToDate' });
    });
});

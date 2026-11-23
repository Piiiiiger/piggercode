import * as React from 'react';

import type { AgyAccountUsageV1 } from '@piggercode/protocol';

import { readAgyAccountUsage, type AgyAccountUsageRead } from '@/sync/ops/agyAccountUsage';
import { useAllMachines } from '@/sync/store/hooks';
import { isRuntimeActive, subscribeToRuntimeActiveChange } from '@/utils/runtime/isRuntimeActive';
import { getMachineDisplayName, isMachineOnline } from '@/utils/sessions/machineUtils';

/** The cadence of the other accounts' usage on this page. */
const AGY_USAGE_READ_INTERVAL_MS = 30_000;

type MachineReading = Readonly<{
    status: AgyAccountUsageRead['kind'];
    accounts: readonly AgyAccountUsageV1[];
}>;

export type AgyMachineUsage = MachineReading & Readonly<{ machineId: string; machineName: string }>;

type UsageState = Readonly<{
    byMachine: ReadonlyMap<string, MachineReading>;
    nowMs: number;
    refreshing: ReadonlySet<string>;
    /** Logins whose last press got no reading, with the reading they still showed then. */
    refreshFailed: ReadonlyMap<string, number | null>;
}>;

export type AgyAccountUsageView = Pick<UsageState, 'nowMs' | 'refreshing'> & Readonly<{
    machines: readonly AgyMachineUsage[];
    /** Whether this login's last press got no reading and nothing newer has come since. */
    didRefreshFail: (machineId: string, account: AgyAccountUsageV1) => boolean;
    refreshAccount: (machineId: string, accountId: string) => Promise<void>;
}>;

export function agyAccountKey(machineId: string, accountId: string): string {
    return `${machineId}:${accountId}`;
}

function nextReading(previous: MachineReading | undefined, read: AgyAccountUsageRead): MachineReading {
    if (read.kind === 'view_on_machine') return { status: 'view_on_machine', accounts: [] };
    // A machine that stopped answering keeps what this screen last saw from it.
    if (read.kind !== 'ok') return { status: 'unavailable', accounts: previous?.accounts ?? [] };
    // A read that started before a press can land after it: the numbers on screen never go back in time.
    const shown = new Map((previous?.accounts ?? []).map((account) => [account.accountId, account]));
    return {
        status: 'ok',
        accounts: read.accounts.map((account) => {
            const before = shown.get(account.accountId);
            return before && (before.observedAtMs ?? 0) > (account.observedAtMs ?? 0) ? before : account;
        }),
    };
}

function land(state: UsageState, machineId: string, read: AgyAccountUsageRead): UsageState {
    const byMachine = new Map(state.byMachine);
    byMachine.set(machineId, nextReading(byMachine.get(machineId), read));
    return { ...state, byMachine, nowMs: Date.now() };
}

/** Each machine's Gemini accounts, read from the machine while the screen is open. Nothing is stored here. */
export function useAgyAccountUsage(): AgyAccountUsageView {
    const allMachines = useAllMachines();
    const targets = React.useMemo(() => allMachines.map((machine) => ({
        machineId: machine.id,
        machineName: getMachineDisplayName(machine) ?? machine.id,
        online: isMachineOnline(machine),
    })), [allMachines]);
    // Machine records change with every heartbeat: only these two facts start a new read.
    const readKey = targets.map((target) => `${target.machineId}:${target.online ? 1 : 0}`).join('|');
    const [state, setState] = React.useState<UsageState>(() => ({
        byMachine: new Map(),
        nowMs: Date.now(),
        refreshing: new Set(),
        refreshFailed: new Map(),
    }));
    const pressing = React.useRef(new Set<string>());

    React.useEffect(() => {
        let cancelled = false;
        // One read per machine at a time, so a machine that does not answer never holds up the others.
        const reading = new Set<string>();
        const readMachine = async (target: (typeof targets)[number]) => {
            reading.add(target.machineId);
            const result: AgyAccountUsageRead = target.online
                ? await readAgyAccountUsage({ machineId: target.machineId })
                : { kind: 'unavailable' };
            reading.delete(target.machineId);
            if (!cancelled) setState((previous) => land(previous, target.machineId, result));
        };
        const readAll = () => {
            if (!isRuntimeActive()) return;
            // Ages and countdowns move on even while a machine does not answer.
            setState((previous) => ({ ...previous, nowMs: Date.now() }));
            for (const target of targets) {
                if (!reading.has(target.machineId)) void readMachine(target);
            }
        };
        readAll();
        const timer = setInterval(readAll, AGY_USAGE_READ_INTERVAL_MS);
        const unsubscribe = subscribeToRuntimeActiveChange(readAll);
        return () => {
            cancelled = true;
            clearInterval(timer);
            unsubscribe();
        };
        // `readKey` stands for the ids and online flags `targets` holds.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readKey]);

    const refreshAccount = React.useCallback(async (machineId: string, accountId: string) => {
        const key = agyAccountKey(machineId, accountId);
        if (pressing.current.has(key)) return;
        pressing.current.add(key);
        setState((previous) => {
            const refreshFailed = new Map(previous.refreshFailed);
            refreshFailed.delete(key);
            return { ...previous, refreshing: new Set(previous.refreshing).add(key), refreshFailed };
        });
        const result = await readAgyAccountUsage({ machineId, refreshAccountId: accountId });
        pressing.current.delete(key);
        setState((previous) => {
            const landed = land(previous, machineId, result);
            const refreshing = new Set(landed.refreshing);
            refreshing.delete(key);
            if (result.kind === 'ok' && result.refreshed === true) return { ...landed, refreshing };
            const shown = landed.byMachine.get(machineId)?.accounts
                .find((account) => account.accountId === accountId)?.observedAtMs ?? null;
            return { ...landed, refreshing, refreshFailed: new Map(landed.refreshFailed).set(key, shown) };
        });
    }, []);

    const { refreshFailed } = state;
    const didRefreshFail = React.useCallback((machineId: string, account: AgyAccountUsageV1) => {
        const key = agyAccountKey(machineId, account.accountId);
        return refreshFailed.has(key) && refreshFailed.get(key) === account.observedAtMs;
    }, [refreshFailed]);

    const machines = React.useMemo(() => targets.flatMap((target) => {
        const reading = state.byMachine.get(target.machineId);
        return reading ? [{ machineId: target.machineId, machineName: target.machineName, ...reading }] : [];
    }), [targets, state.byMachine]);

    return { machines, nowMs: state.nowMs, refreshing: state.refreshing, didRefreshFail, refreshAccount };
}

import type { Machine } from '@/sync/domains/state/storageTypes';
import { isMachineAgentHost, isMachineLaunchTarget } from '@/sync/domains/machines/identity/machineAgentHost';
import { isMachineOnline } from '@/utils/sessions/machineUtils';

type RecentMachinePathEntry = Readonly<{ machineId?: string | null }> | null | undefined;

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function pushUniqueMachineId(next: string[], seen: Set<string>, value: unknown): void {
  const machineId = normalizeId(value);
  if (!machineId || seen.has(machineId)) return;
  seen.add(machineId);
  next.push(machineId);
}

export function listPreferredMachineIds(params: Readonly<{
  machines: ReadonlyArray<Machine>;
  recentMachinePaths: ReadonlyArray<RecentMachinePathEntry>;
  preferredMachineId?: string | null;
  onlineOnly?: boolean;
}>): string[] {
  const machines = Array.isArray(params.machines) ? params.machines : [];
  const recentMachinePaths = Array.isArray(params.recentMachinePaths) ? params.recentMachinePaths : [];
  const preferredMachineId = normalizeId(params.preferredMachineId);
  const onlineOnly = params.onlineOnly === true;
  const machineById = new Map(machines.map((machine) => [normalizeId(machine.id), machine] as const));
  const ordered: string[] = [];
  const seen = new Set<string>();

    const pushIfEligible = (machineId: unknown) => {
        const normalizedMachineId = normalizeId(machineId);
        if (!normalizedMachineId) return;
        const machine = machineById.get(normalizedMachineId);
        if (!machine) return;
        if (!isMachineLaunchTarget(machine)) return;
        if (onlineOnly && !isMachineOnline(machine)) return;
        pushUniqueMachineId(ordered, seen, normalizedMachineId);
    };

  if (preferredMachineId) {
    pushIfEligible(preferredMachineId);
  }

  for (const recent of recentMachinePaths) {
    pushIfEligible(recent?.machineId);
  }

  for (const machine of machines) {
    if (!isMachineLaunchTarget(machine)) continue;
    if (isMachineOnline(machine)) {
      pushUniqueMachineId(ordered, seen, machine.id);
    }
  }

  if (onlineOnly) {
    return ordered;
  }

  // A remembered machine stays preferred while unknown or offline, but never one that runs no agents.
  const pushRemembered = (machineId: unknown) => {
    const machine = machineById.get(normalizeId(machineId));
    if (machine && !isMachineAgentHost(machine)) return;
    pushUniqueMachineId(ordered, seen, machineId);
  };

  if (preferredMachineId) {
    pushRemembered(preferredMachineId);
  }

  for (const recent of recentMachinePaths) {
    pushRemembered(recent?.machineId);
  }

  for (const machine of machines) {
    if (!isMachineLaunchTarget(machine)) continue;
    pushUniqueMachineId(ordered, seen, machine.id);
  }

  return ordered;
}

export function resolvePreferredMachineId(params: Readonly<{
  machines: ReadonlyArray<Machine>;
  recentMachinePaths: ReadonlyArray<RecentMachinePathEntry>;
  preferredMachineId?: string | null;
  onlineOnly?: boolean;
}>): string | null {
  return listPreferredMachineIds(params)[0] ?? null;
}

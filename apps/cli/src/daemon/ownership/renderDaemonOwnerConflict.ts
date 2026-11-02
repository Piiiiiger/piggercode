import type { CurrentDaemonOwner } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import { buildDaemonTakeoverHint } from '@/daemon/ownership/resolveDaemonTakeoverDecision';

type DaemonOwnerConflictIntent =
  | 'session-autostart'
  | 'daemon-start'
  | 'daemon-start-sync'
  | 'daemon-stop'
  | 'daemon-restart';

function describeOwner(owner: CurrentDaemonOwner): string {
  if (owner.serviceManaged === true) {
    return 'background service';
  }
  if (owner.serviceManaged === false) {
    return 'manual start';
  }
  return 'unknown';
}

function buildOwnerDetails(owner: CurrentDaemonOwner): string[] {
  const details = [
    `Started by: ${describeOwner(owner)}`,
    `Current release channel: ${owner.state.startedWithPublicReleaseChannel ?? 'unknown'}`,
    `Current CLI version: ${owner.state.startedWithCliVersion}`,
  ];
  if (owner.state.serviceLabel) {
    details.push(`Background service label: ${owner.state.serviceLabel}`);
  }
  return details;
}

export function renderDaemonOwnerConflict(params: Readonly<{
  intent: DaemonOwnerConflictIntent;
  owner: CurrentDaemonOwner;
}>): Readonly<{ title: string; lines: readonly string[] }> {
  const owner = params.owner;
  const details = buildOwnerDetails(owner);

  if (params.intent === 'session-autostart') {
    return {
      title: owner.serviceManaged === true
        ? 'A different background service is already running for the selected relay.'
        : owner.serviceManaged === false
          ? 'A different manually started daemon is already running for the selected relay.'
          : 'A different running daemon is already using the selected relay.',
      lines: [
        ...details,
        owner.serviceManaged
          ? 'PiggerCode will continue without switching it.'
          : owner.serviceManaged === false
            ? 'PiggerCode will continue without starting another daemon.'
            : 'PiggerCode will continue without changing the current daemon.',
        owner.serviceManaged
          ? 'Use `piggercode doctor repair` if you want automatic startup to switch to this installation.'
          : owner.serviceManaged === false
            ? 'Use `piggercode daemon restart` if you want to replace the current manual daemon.'
            : 'Restart the current daemon before trying to switch which installation is running.',
      ],
    };
  }

  if (params.intent === 'daemon-start') {
    return {
      title: owner.serviceManaged === true
        ? 'A background service is already running for the selected relay.'
        : owner.serviceManaged === false
          ? 'Another manually started daemon is already running for the selected relay.'
          : 'Another running daemon is already using the selected relay.',
      lines: [
        ...details,
        owner.serviceManaged
          ? 'Use `piggercode doctor repair` if you want automatic startup to switch to this installation.'
          : owner.serviceManaged === false
            ? [
                'Stop the current manual daemon with `piggercode daemon stop` before starting another one.',
                buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'start' }),
              ].join(' ')
            : [
                'Stop the current daemon before starting another one.',
                `If this is a legacy manual daemon start, ${buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'start' }).toLowerCase()}`,
              ].join(' '),
      ],
    };
  }

  if (params.intent === 'daemon-start-sync') {
    return {
      title: owner.serviceManaged === true
        ? 'A background service is already running for the selected relay.'
        : owner.serviceManaged === false
          ? 'Another manually started daemon is already running for the selected relay.'
          : 'Another running daemon is already using the selected relay.',
      lines: [
        ...details,
        owner.serviceManaged
          ? 'Use `piggercode doctor repair` if you want automatic startup to switch to this installation.'
          : owner.serviceManaged === false
            ? [
                'Stop the current manual daemon with `piggercode daemon stop` before starting another one.',
                buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'start-sync' }),
              ].join(' ')
            : [
                'Stop the current daemon before starting another one.',
                `If this is a legacy manual daemon start, ${buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'start-sync' }).toLowerCase()}`,
              ].join(' '),
      ],
    };
  }

  if (params.intent === 'daemon-restart') {
    if (owner.serviceManaged === false) {
      return {
        title: 'Another manually started daemon is already running for the selected relay.',
        lines: [
          ...details,
          buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'restart' }),
        ],
      };
    }

    return {
      title: owner.serviceManaged === true
        ? 'The current daemon is managed by a background service.'
        : 'PiggerCode could not determine how the current daemon was started.',
      lines: [
        ...details,
        owner.serviceManaged === true
          ? 'Use `piggercode doctor repair` instead of `piggercode daemon restart`.'
          : [
              `If this is a legacy manual daemon start, ${buildDaemonTakeoverHint({ commandPath: 'piggercode daemon', action: 'restart' }).toLowerCase()}`,
              'Use `piggercode service restart` only if you know the current daemon came from the background service.',
            ].join(' '),
      ],
    };
  }

  return {
    title: owner.serviceManaged === true
      ? 'The current daemon is managed by a background service.'
      : 'PiggerCode could not determine how the current daemon was started.',
    lines: [
      ...details,
      owner.serviceManaged === true
        ? 'Use `piggercode service stop` instead of `piggercode daemon stop`.'
        : 'Use `piggercode service stop` only if you know the current daemon came from the background service.',
    ],
  };
}

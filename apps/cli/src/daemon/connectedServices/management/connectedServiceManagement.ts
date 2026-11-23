import {
  ConnectedServicesManagementV1Schema,
  DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1,
  isConnectedServiceSubscriptionLogin,
  type ConnectedServiceId,
  type ConnectedServicesManagementV1,
} from '@piggercode/protocol';


/** What a daemon may do with a subscription login (see `isConnectedServiceSubscriptionLogin`). */
export type ConnectedServiceManagementOperation =
  | 'refresh'
  | 'usage'
  | 'launch';

export type ConnectedServiceManagementDenialReason =
  /** Account settings have not been read from the relay since this daemon (re)connected. */
  | 'settings_unconfirmed'
  /** The account has not chosen a managing machine yet. */
  | 'no_managing_machine'
  /** Another machine manages subscription logins. */
  | 'not_managing_machine'
  /** Launches with subscription logins are paused account-wide. */
  | 'pools_paused'
  /** This process is not the daemon, which alone holds subscription logins. */
  | 'requires_daemon'
  /** A known machine runs a CLI that predates single-machine management (launches only). */
  | 'outdated_machines'
  /** The relay cannot compare-and-set credentials, which reading a client's rotation back needs. */
  | 'relay_without_revisions'
  /**
   * A pool of logins whose clients rotate their own tokens would share one home, so one member's
   * unsaved rotation could be overwritten by the next; pools use per-account homes first (U2).
   */
  | 'shared_pool_home'
  /**
   * The daemon runs without its refresh owner (connected-service refresh turned off, or not started yet):
   * nothing would hold a login while a launch prepares it, read a native client's rotations back or
   * refresh it.
   */
  | 'refresh_owner_unavailable';

export type ConnectedServiceManagementDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      reason: ConnectedServiceManagementDenialReason;
      managingMachineId: string | null;
      /** For `outdated_machines`: which machines (host or id). */
      outdatedMachines?: ReadonlyArray<string>;
    }>;

const ALLOWED: ConnectedServiceManagementDecision = Object.freeze({ allowed: true });

function readManagementSettings(settings: unknown): ConnectedServicesManagementV1 {
  const raw = settings && typeof settings === 'object'
    ? (settings as Readonly<Record<string, unknown>>).connectedServicesManagementV1
    : undefined;
  const parsed = ConnectedServicesManagementV1Schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_CONNECTED_SERVICES_MANAGEMENT_V1;
}

/**
 * The single decision for acting on subscription logins. v1 lets exactly one machine refresh their
 * tokens, read their usage and launch sessions with them: two machines rotating one refresh token
 * would invalidate each other. Everything is refused until settings confirmed by the relay name
 * this machine. Other services (API keys, tokens) are never restricted.
 */
export function decideConnectedServiceManagement(input: Readonly<{
  serviceId: ConnectedServiceId;
  operation: ConnectedServiceManagementOperation;
  machineId: string;
  /** Settings read from the relay since the current connection began; null when unconfirmed. */
  confirmedSettings: unknown;
  /** Known machines whose CLI predates single-machine management, as read with those settings. */
  outdatedMachines?: ReadonlyArray<string>;
}>): ConnectedServiceManagementDecision {
  if (!isConnectedServiceSubscriptionLogin(input.serviceId)) return ALLOWED;
  if (!input.confirmedSettings) {
    return { allowed: false, reason: 'settings_unconfirmed', managingMachineId: null };
  }
  const management = readManagementSettings(input.confirmedSettings);
  const managingMachineId = management.managingMachineId;
  if (!managingMachineId) return { allowed: false, reason: 'no_managing_machine', managingMachineId: null };
  if (managingMachineId !== input.machineId.trim()) {
    return { allowed: false, reason: 'not_managing_machine', managingMachineId };
  }
  if (input.operation === 'launch' && management.poolsPaused) {
    return { allowed: false, reason: 'pools_paused', managingMachineId };
  }
  if (input.operation === 'launch' && input.outdatedMachines && input.outdatedMachines.length > 0) {
    return { allowed: false, reason: 'outdated_machines', managingMachineId, outdatedMachines: input.outdatedMachines };
  }
  return ALLOWED;
}

export type ConnectedServiceManagement = Readonly<{
  decide: (serviceId: ConnectedServiceId, operation: ConnectedServiceManagementOperation) => ConnectedServiceManagementDecision;
  /**
   * The launch decision, made on settings and a machine inventory read again for this launch: a
   * machine may have joined on an older CLI, or been downgraded, since the connection confirmed them.
   */
  decideLaunch: (serviceId: ConnectedServiceId) => Promise<ConnectedServiceManagementDecision>;
}>;

/** Management for processes other than the daemon: subscription logins are only used through it. */
export const DAEMON_REQUIRED_CONNECTED_SERVICE_MANAGEMENT: ConnectedServiceManagement = Object.freeze({
  decide: decideRequiresDaemon,
  decideLaunch: async (serviceId: ConnectedServiceId) => decideRequiresDaemon(serviceId),
});

function decideRequiresDaemon(serviceId: ConnectedServiceId): ConnectedServiceManagementDecision {
  return isConnectedServiceSubscriptionLogin(serviceId)
    ? { allowed: false, reason: 'requires_daemon', managingMachineId: null }
    : ALLOWED;
}

let processManagement: ConnectedServiceManagement = DAEMON_REQUIRED_CONNECTED_SERVICE_MANAGEMENT;

/** The daemon installs its authority; every other process keeps refusing subscription logins. */
export function setProcessConnectedServiceManagement(management: ConnectedServiceManagement): void {
  processManagement = management;
}

/** Management for code that runs in whichever process serves it (e.g. capability probes). */
export function getProcessConnectedServiceManagement(): ConnectedServiceManagement {
  return processManagement;
}

export function resetProcessConnectedServiceManagementForTests(): void {
  processManagement = DAEMON_REQUIRED_CONNECTED_SERVICE_MANAGEMENT;
}

const DENIAL_MESSAGES: Readonly<Record<ConnectedServiceManagementDenialReason, string>> = {
  settings_unconfirmed: 'Account settings are still loading on this machine; try again in a moment.',
  no_managing_machine: 'Choose the machine that manages subscription accounts in Settings > Connected services first.',
  not_managing_machine: 'Subscription accounts are managed by another machine; start this session there.',
  pools_paused: 'Account pools are paused in Settings > Connected services.',
  requires_daemon: 'Subscription accounts are only used through the PiggerCode daemon; start this session from the app or with the daemon running.',
  outdated_machines: 'Another machine of this account runs an older PiggerCode CLI that would also use subscription accounts; update it or remove it first.',
  relay_without_revisions: 'This relay cannot protect subscription accounts from conflicting writes; update the relay first.',
  shared_pool_home: 'Account pools cannot start sessions with this subscription account yet; choose a single account for now.',
  refresh_owner_unavailable: 'Connected-service refresh is not running on this machine (turned off, or still starting), so it does not use subscription accounts now.',
};

/** A launch with a subscription login that this machine or process may not perform. */
export class ConnectedServiceManagementDeniedError extends Error {
  readonly serviceId: ConnectedServiceId;
  readonly reason: ConnectedServiceManagementDenialReason;
  readonly managingMachineId: string | null;

  constructor(params: Readonly<{
    serviceId: ConnectedServiceId;
    reason: ConnectedServiceManagementDenialReason;
    managingMachineId: string | null;
    outdatedMachines?: ReadonlyArray<string>;
  }>) {
    super(params.outdatedMachines && params.outdatedMachines.length > 0
      ? `${DENIAL_MESSAGES[params.reason]} (${params.outdatedMachines.join(', ')})`
      : DENIAL_MESSAGES[params.reason]);
    this.name = 'ConnectedServiceManagementDeniedError';
    this.serviceId = params.serviceId;
    this.reason = params.reason;
    this.managingMachineId = params.managingMachineId;
  }
}

/** The error a refused decision raises, the same at every entry (launch, switch). */
export function connectedServiceManagementDeniedError(
  serviceId: ConnectedServiceId,
  decision: Extract<ConnectedServiceManagementDecision, { allowed: false }>,
): ConnectedServiceManagementDeniedError {
  return new ConnectedServiceManagementDeniedError({
    serviceId,
    reason: decision.reason,
    managingMachineId: decision.managingMachineId,
    ...(decision.outdatedMachines ? { outdatedMachines: decision.outdatedMachines } : {}),
  });
}

/**
 * Daemon-scoped owner of whether account settings are confirmed for the current relay connection.
 * A connection (start, reconnect) begins unconfirmed; it is confirmed only by a settings read from
 * the relay made during that same connection, so a stale cached snapshot never authorizes work.
 */
export class ConnectedServiceManagementAuthority implements ConnectedServiceManagement {
  private connection = 0;
  private confirmedConnection: number | null = null;
  private outdatedMachines: ReadonlyArray<string> = [];
  private confirming: Promise<void> | null = null;
  private failedReads = 0;
  private nextReadAtMs = 0;

  constructor(private readonly deps: Readonly<{
    machineId: () => string;
    /** The daemon's current account settings (updated by relay hints). */
    readSettings: () => unknown;
    /**
     * Reads account settings from the relay (rejects when it cannot) and the known machines whose CLI
     * predates single-machine management. Absent in tests that confirm explicitly.
     */
    readSettingsFromRelay?: () => Promise<Readonly<{ outdatedMachines: ReadonlyArray<string> }>>;
    /** Delay before retrying after `failedReads` unconfirmed reads (the settings owner's backoff policy). */
    retryDelayMs?: (failedReads: number) => number;
    now?: () => number;
    onConfirmationFailed?: (error: unknown) => void;
    /**
     * Whether this daemon runs its refresh owner, which holds and reads back a login whose native client
     * rotates it (absent: it does).
     */
    refreshOwnerRunning?: () => boolean;
  }>) {}

  /** A relay connection started: refuse until settings are read on it. */
  beginConnection(): number {
    this.connection += 1;
    this.failedReads = 0;
    this.nextReadAtMs = 0;
    this.ensureConfirmation();
    return this.connection;
  }

  /** The relay connection was lost: refuse until the next connection confirms settings again. */
  loseConnection(): void {
    this.connection += 1;
  }

  /** Account settings were read from the relay while `connection` was current. */
  confirmSettingsRead(connection: number, outdatedMachines: ReadonlyArray<string> = []): boolean {
    if (connection !== this.connection) return false;
    this.confirmedConnection = connection;
    this.outdatedMachines = outdatedMachines;
    return true;
  }

  decide(serviceId: ConnectedServiceId, operation: ConnectedServiceManagementOperation): ConnectedServiceManagementDecision {
    // Without the refresh owner this daemon cannot hold, read back or refresh a subscription login, and a
    // client already running on one (reattached after a restart) would leave its relay copy behind.
    if (isConnectedServiceSubscriptionLogin(serviceId) && this.deps.refreshOwnerRunning?.() === false) {
      return { allowed: false, reason: 'refresh_owner_unavailable', managingMachineId: null };
    }
    const confirmed = this.confirmedConnection === this.connection;
    const decision = decideConnectedServiceManagement({
      serviceId,
      operation,
      machineId: this.deps.machineId(),
      confirmedSettings: confirmed ? this.deps.readSettings() : null,
      outdatedMachines: this.outdatedMachines,
    });
    // An unconfirmed daemon, or one refused for outdated machines, reads again when work next asks
    // (the refresh/usage ticks and launches pace it, the settings owner's backoff spaces it).
    if (!confirmed || (!decision.allowed && decision.reason === 'outdated_machines')) this.ensureConfirmation();
    return decision;
  }

  async decideLaunch(serviceId: ConnectedServiceId): Promise<ConnectedServiceManagementDecision> {
    const read = this.deps.readSettingsFromRelay;
    if (read && this.connection !== 0 && isConnectedServiceSubscriptionLogin(serviceId)) {
      const connection = this.connection;
      try {
        const { outdatedMachines } = await read();
        this.confirmSettingsRead(connection, outdatedMachines);
      } catch (error) {
        // Without this read the launch cannot know the current machines; the connection's earlier
        // confirmation still serves refreshes and usage.
        this.deps.onConfirmationFailed?.(error);
        return { allowed: false, reason: 'settings_unconfirmed', managingMachineId: null };
      }
    }
    return this.decide(serviceId, 'launch');
  }

  private ensureConfirmation(): void {
    const read = this.deps.readSettingsFromRelay;
    if (!read || this.confirming || this.connection === 0) return;
    if (this.now() < this.nextReadAtMs) return;
    const connection = this.connection;
    const retryLater = (): void => {
      if (connection !== this.connection) return;
      this.failedReads += 1;
      this.nextReadAtMs = this.now() + (this.deps.retryDelayMs?.(this.failedReads) ?? 0);
    };
    this.confirming = read()
      .then(({ outdatedMachines }) => {
        this.confirmSettingsRead(connection, outdatedMachines);
        if (outdatedMachines.length > 0) retryLater();
      })
      .catch((error: unknown) => {
        retryLater();
        this.deps.onConfirmationFailed?.(error);
      })
      .finally(() => {
        this.confirming = null;
      });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

import type { AgentBackend, McpServerConfig } from '@/agent/core/AgentBackend';
import type { AcpPermissionHandler } from '@/agent/acp/AcpBackend';
import type { AgentPromptPayload } from '@/agent/core/AgentPromptPayload';
import type { AgentId } from '@piggercode/agents';
import type { AcpConfigOptionOverridesV1, BackendTargetRefV1 } from '@piggercode/protocol';

import { sendAgentPromptPayload, sendAgentSteerPromptPayload } from '@/agent/core/AgentPromptPayload';
import { createExecutionRunPermissionHandler } from '@/agent/executionRuns/policy/executionRunPermissionDecision';
import { getExecutionRunBackendDescriptor } from '@/agent/executionRuns/registry/executionRunBackendRegistry';
import { resolveCustomHappierToolsContext } from '@/agent/tools/happierTools/customMcp/resolveCustomHappierToolsContext';
import { resolveBackendIsolationBundle } from '@/runtime/isolation/resolveBackendIsolationBundle';
import { readCredentials, readSettings } from '@/persistence';
import { getActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { assertBackendEnabledByAccountSettings } from '@/settings/backendEnabled';
import { createRunScopedExecutionPermissionHandler } from './runScopedExecutionPermissionHandler';

export { createRunScopedExecutionPermissionHandler } from './runScopedExecutionPermissionHandler';

export { createExecutionRunPermissionHandler } from '@/agent/executionRuns/policy/executionRunPermissionDecision';

function startBestEffortConstructionCleanup(cleanup: (() => void | Promise<void>) | null): void {
  if (!cleanup) return;
  try {
    void Promise.resolve(cleanup()).catch(() => {});
  } catch {
    // Construction must preserve its original error even when cleanup itself throws synchronously.
  }
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAccountSettings(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

function resolveExecutionRunAccountSettings(params: Readonly<{
  backendTarget?: BackendTargetRefV1;
  accountSettings?: unknown;
}>): Readonly<Record<string, unknown>> | null {
  const explicitSettings = normalizeAccountSettings(params.accountSettings);
  if (explicitSettings) return explicitSettings;
  return normalizeAccountSettings(getActiveAccountSettingsSnapshot()?.settings ?? null);
}

type ExecutionRunMcpResolutionContext = Readonly<{
  credentials?: Awaited<ReturnType<typeof readCredentials>> | null;
  accountSettings?: Readonly<Record<string, unknown>> | null;
}>;

function createExecutionRunMcpServersResolver(opts: Readonly<{
  cwd: string;
  backendTarget?: BackendTargetRefV1;
  accountSettings?: Readonly<Record<string, unknown>> | null;
  onMaterialized: (cleanup: () => void) => void;
}>): (context?: ExecutionRunMcpResolutionContext) => Promise<Record<string, McpServerConfig>> {
  let resolution: Promise<Record<string, McpServerConfig>> | null = null;
  return (context = {}) => {
    if (!resolution) {
      resolution = (async () => {
        const credentials = context.credentials ?? await readCredentials();
        if (!credentials) return {};
        const accountSettings = context.accountSettings
          ?? opts.accountSettings
          ?? normalizeAccountSettings((await bootstrapAccountSettingsContext({
            credentials,
            ...(opts.backendTarget ? { backendTarget: opts.backendTarget } : {}),
            mode: 'fast',
          })).settings);
        if (!accountSettings) return {};
        const machineId = normalizeNonEmptyString((await readSettings()).machineId);
        if (!machineId) return {};
        const materialized = await resolveCustomHappierToolsContext({
          credentials,
          accountSettings,
          machineId,
          directory: opts.cwd,
        });
        opts.onMaterialized(materialized.cleanup);
        return materialized.mcpServers;
      })();
    }
    return resolution;
  };
}

export function createExecutionRunBackend(opts: Readonly<{
  cwd: string;
  runId?: string;
  backendId: string;
  backendTarget?: BackendTargetRefV1;
  modelId?: string;
  /**
   * Optional canonical config-option overrides for the run (e.g. `reasoning_effort`), SAME shape as
   * session spawn. Threaded to the backend factory so providers apply run options exactly like a
   * spawned session. Absent keeps the backend's configured defaults.
   */
  sessionConfigOptionOverrides?: AcpConfigOptionOverridesV1;
  permissionMode: string;
  accountSettings?: Readonly<Record<string, unknown>> | null;
  start?: Readonly<{ intentInput?: unknown; retentionPolicy?: string; intent?: string }> | null;
  /**
   * Provider-agnostic connected-service environment for this run, already materialized by the daemon
   * run-materialization bridge (e.g. `CODEX_HOME`/`CLAUDE_CONFIG_DIR`). Merged into the isolation
   * bundle BEFORE the per-backend `resolveIsolation` so runs use CS accounts/pools exactly like
   * sessions. No provider knowledge lives here — the keys come from the daemon materializer.
   */
  connectedServicesEnv?: Readonly<Record<string, string>> | null;
  /**
   * Idempotent run-end release for the daemon-side CS registration + run-scoped materialized root.
   * Invoked on backend dispose (run end / stop) regardless of retention policy — the materialized
   * root is run-scoped, so a later resume re-materializes rather than reusing a stale root.
   */
  connectedServicesCleanup?: (() => Promise<void>) | null;
  interactivePermissionHandler?: AcpPermissionHandler;
}>): AgentBackend {
  const connectedServicesCleanup = opts.connectedServicesCleanup ?? null;
  const mcpMaterialCleanups: Array<() => void> = [];
  let mcpMaterialDisposed = false;
  const cleanupMcpMaterial = () => {
    mcpMaterialDisposed = true;
    for (const cleanup of mcpMaterialCleanups.splice(0)) cleanup();
  };
  let acquiredIsolationCleanup: (() => void | Promise<void>) | null = null;
  try {
    const backendId = String(opts.backendId ?? '').trim();
    const accountSettings = resolveExecutionRunAccountSettings({
      backendTarget: opts.backendTarget,
      accountSettings: opts.accountSettings,
    });
    const resolveMcpServers = createExecutionRunMcpServersResolver({
      cwd: opts.cwd,
      ...(opts.backendTarget ? { backendTarget: opts.backendTarget } : {}),
      accountSettings,
      onMaterialized: (cleanup) => {
        if (mcpMaterialDisposed) cleanup();
        else mcpMaterialCleanups.push(cleanup);
      },
    });
    if (accountSettings && opts.backendTarget?.kind === 'builtInAgent') {
      assertBackendEnabledByAccountSettings({
        agentId: opts.backendTarget.agentId as AgentId,
        backendTarget: opts.backendTarget,
        settings: accountSettings,
      });
    }
    const runId = normalizeNonEmptyString(opts.runId);
    const runPermissionScope = opts.interactivePermissionHandler && runId
      ? createRunScopedExecutionPermissionHandler({ runId, handler: opts.interactivePermissionHandler })
      : null;
    const permissionHandler = createExecutionRunPermissionHandler({
      backendId,
      permissionMode: opts.permissionMode,
      interactiveHandler: runPermissionScope?.handler,
    });
    const descriptor = getExecutionRunBackendDescriptor(backendId);
    if (!descriptor) {
      throw new Error(`Unsupported execution-run backend: ${backendId}`);
    }

    const connectedServicesEnv = opts.connectedServicesEnv && typeof opts.connectedServicesEnv === 'object'
      ? opts.connectedServicesEnv
      : null;
    const hasConnectedServicesEnv = connectedServicesEnv !== null && Object.keys(connectedServicesEnv).length > 0;

    const retentionPolicy = String(opts.start?.retentionPolicy ?? '').trim();
    const shouldCleanupIsolation = retentionPolicy === 'ephemeral';
    const shouldIsolate = shouldCleanupIsolation
      || String(opts.runId ?? '').trim().length > 0
      || hasConnectedServicesEnv;
    const intent = (() => {
      const raw = String(opts.start?.intent ?? '').trim();
      return raw.length > 0 ? raw : undefined;
    })();

    const isolationId = shouldIsolate ? (String(opts.runId ?? '').trim() || `run_${backendId}_${Date.now()}`) : '';
    const resolvedBaseBundle = shouldIsolate
      ? resolveBackendIsolationBundle({
          backendId,
          isolationId,
          scope: 'execution_run',
          ...(intent ? { intent } : {}),
          cwd: opts.cwd,
        })
      : null;
    if (shouldCleanupIsolation) {
      acquiredIsolationCleanup = resolvedBaseBundle?.cleanup ?? null;
    }

    // Generic, pre-descriptor CS env merge (design pin: the isolation-bundle choke point). Provider env
    // keys (e.g. `CODEX_HOME`) come from the daemon materializer and take precedence over the base
    // isolation env so the run reads the materialized CS home instead of the runner's inherited account.
    const baseBundle = resolvedBaseBundle && hasConnectedServicesEnv && connectedServicesEnv
      ? { ...resolvedBaseBundle, env: { ...resolvedBaseBundle.env, ...connectedServicesEnv } }
      : resolvedBaseBundle;

    const bundle = baseBundle && descriptor.resolveIsolation
      ? descriptor.resolveIsolation(
          {
            backendId,
            isolationId,
            scope: 'execution_run',
            ...(intent ? { intent } : {}),
            cwd: opts.cwd,
          },
          baseBundle,
        )
      : baseBundle;
    if (shouldCleanupIsolation) {
      acquiredIsolationCleanup = bundle?.cleanup ?? acquiredIsolationCleanup;
    }

    const shouldCleanupBundleOnDispose = shouldCleanupIsolation && Boolean(bundle?.cleanup);
    const backend = descriptor.factory({
      cwd: opts.cwd,
      backendId,
      modelId: opts.modelId,
      ...(opts.sessionConfigOptionOverrides ? { sessionConfigOptionOverrides: opts.sessionConfigOptionOverrides } : {}),
      permissionMode: opts.permissionMode,
      accountSettings,
      resolveMcpServers,
      permissionHandler,
      start: opts.start ?? null,
      ...(bundle ? { isolation: { env: bundle.env, settingsPath: bundle.settingsPath } } : {}),
    });

    const originalDispose = backend.dispose.bind(backend);
    let disposal: Promise<void> | null = null;
    backend.dispose = () => {
      if (!disposal) {
        disposal = (async () => {
          runPermissionScope?.dispose('Execution run disposed');
          try {
            await originalDispose();
          } finally {
            try {
              cleanupMcpMaterial();
            } finally {
              try {
                if (shouldCleanupBundleOnDispose) {
                  await bundle?.cleanup?.();
                }
              } finally {
                // Run-end ER-CS release (idempotent, best-effort inside the callback itself).
                await connectedServicesCleanup?.();
              }
            }
          }
        })();
      }
      return disposal;
    };

    return backend;
  } catch (error) {
    // Connected-service materialization and every synchronous backend-construction stage are one
    // acquisition boundary. Start both best-effort cleanups, but never replace the construction
    // error with a cleanup failure. The connected callback itself owns its shared once-promise.
    startBestEffortConstructionCleanup(acquiredIsolationCleanup);
    startBestEffortConstructionCleanup(connectedServicesCleanup);
    throw error;
  }
}

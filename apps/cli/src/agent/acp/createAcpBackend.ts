/**
 * ACP Backend Factory Helper
 *
 * Provides a simplified factory function for creating ACP-based agent backends.
 * Use this when you need to create a generic ACP backend without agent-specific
 * configuration (timeouts, filtering, etc.).
 *
 * For agent-specific backends, use the agent ACP backends under `backends/<agent>/acp`.
 *
 * @module createAcpBackend
 */

import {
  AcpBackend,
  type AcpBackendOptions,
  type AcpExtensionHandlers,
  type AcpPermissionHandler,
  type AcpSessionModelAdapter,
} from './AcpBackend';
import type { AcpAuthentication } from './AcpAuthentication';
import type { McpServerConfig } from '../core';
import { DefaultTransport, type TransportHandler } from '../transport';

/**
 * Simplified options for creating an ACP backend
 */
export interface CreateAcpBackendOptions {
  /** Agent name for identification */
  agentName: string;

  /** Working directory for the agent */
  cwd: string;

  /** Command to spawn the ACP agent */
  command: string;

  /** Arguments for the agent command */
  args?: string[];

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Provider-owned, process-scoped launch materialization performed immediately before spawn. */
  prepareProcessLaunch?: AcpBackendOptions['prepareProcessLaunch'];

  /** Inherited process environment variables to remove before provider env overrides are applied */
  unsetEnv?: readonly string[];

  /** MCP servers to make available to the agent */
  mcpServers?: Record<string, McpServerConfig>;

  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;

  /** Optional transport handler for agent-specific behavior */
  transportHandler?: TransportHandler;

  /** Optional authentication selected only after a successful ACP initialize response. */
  authentication?: AcpAuthentication;
  isAuthenticationSetupFailure?: AcpBackendOptions['isAuthenticationSetupFailure'];

  /** Optional ACP initialize _meta payload for provider-specific extension negotiation. */
  initializeMeta?: Record<string, unknown>;

  /** Optional ACP clientCapabilities._meta payload for provider-specific extension negotiation. */
  initializeClientCapabilitiesMeta?: Record<string, unknown>;

  /** Provider-owned handlers for non-standard ACP extension requests/notifications. */
  extensionHandlers?: AcpExtensionHandlers;

  /** Provider-owned projection/application for model metadata not standardized by ACP. */
  sessionModelAdapter?: AcpSessionModelAdapter;
  sessionModesEnabled?: AcpBackendOptions['sessionModesEnabled'];

  /** Configured-catalog policy for session/load. Undefined retains built-in provider behavior. */
  declaredSessionLoadSupport?: boolean;
}

/**
 * Create a generic ACP backend.
 *
 * This is a low-level factory for creating ACP backends. For most use cases,
 * prefer the agent-specific factories that include proper transport handlers:
 *
 * ```typescript
 * import { createAcpBackend } from '@/agent/acp';
 * const backend = createAcpBackend({
 *   agentName: 'codex',
 *   cwd: '/path/to/project',
 *   command: 'codex-acp',
 *   args: [],
 * });
 * ```
 *
 * @param options - Configuration options
 * @returns AgentBackend instance
 */
export function createAcpBackend(options: CreateAcpBackendOptions): AcpBackend {
  const backendOptions: AcpBackendOptions = {
    agentName: options.agentName,
    cwd: options.cwd,
    command: options.command,
    args: options.args,
    env: options.env,
    prepareProcessLaunch: options.prepareProcessLaunch,
    unsetEnv: options.unsetEnv,
    mcpServers: options.mcpServers,
    permissionHandler: options.permissionHandler,
    transportHandler: options.transportHandler ?? new DefaultTransport(options.agentName),
    authentication: options.authentication,
    isAuthenticationSetupFailure: options.isAuthenticationSetupFailure,
    initializeMeta: options.initializeMeta,
    initializeClientCapabilitiesMeta: options.initializeClientCapabilitiesMeta,
    extensionHandlers: options.extensionHandlers,
    sessionModelAdapter: options.sessionModelAdapter,
    sessionModesEnabled: options.sessionModesEnabled,
    declaredSessionLoadSupport: options.declaredSessionLoadSupport,
  };

  return new AcpBackend(backendOptions);
}

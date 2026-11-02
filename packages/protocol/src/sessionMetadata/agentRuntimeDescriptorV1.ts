import { z } from 'zod';
import { normalizeCodexBackendMode, type CodexBackendMode } from '../providers/codex/backendMode.js';

type AgentRuntimeDescriptorProviderShape = Readonly<Record<string, unknown>>;

export type AgentRuntimeDescriptorProviderExtraV1 = Readonly<{
  owner: string;
  schemaId: string;
  v: number;
} & Record<string, unknown>>;

export type AgentRuntimeDescriptorEnvelopeV1<
  TProviderId extends string = string,
  TProvider extends AgentRuntimeDescriptorProviderShape = AgentRuntimeDescriptorProviderShape,
> = Readonly<{
  v: 1;
  providerId: TProviderId;
  provider: TProvider;
} & Record<string, unknown>>;

type CodexAgentRuntimeDescriptorProvider = Readonly<{
  backendMode: CodexBackendMode;
  vendorSessionId?: string;
  homePath?: string;
  sqliteHomePath?: string;
  home?: 'user' | 'connectedService';
  connectedServiceId?: string;
  connectedServiceProfileId?: string;
  connectedServiceGroupId?: string;
  providerExtra?: Readonly<AgentRuntimeDescriptorProviderExtraV1 & {
    runtimeAffinity?: Readonly<{
      backendMode?: CodexBackendMode;
      vendorSessionId?: string;
      homePath?: string;
      sqliteHomePath?: string;
      home?: 'user' | 'connectedService';
      connectedServiceId?: string;
      connectedServiceProfileId?: string;
      connectedServiceGroupId?: string;
    }>;
  }>;
}>;

export type CodexAgentRuntimeDescriptorV1 = AgentRuntimeDescriptorEnvelopeV1<'codex', CodexAgentRuntimeDescriptorProvider>;
export type AgentRuntimeDescriptorV1 = AgentRuntimeDescriptorEnvelopeV1;

type CanonicalAgentRuntimeDescriptorByProviderId = {
  codex: Readonly<{
    providerId: 'codex';
    backendMode: CodexBackendMode | null;
    vendorSessionId: string | null;
    home: 'user' | 'connectedService' | null;
    connectedServiceId: string | null;
    connectedServiceProfileId: string | null;
    connectedServiceGroupId: string | null;
    homePath: string | null;
    sqliteHomePath: string | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeCodexHome(value: unknown): CanonicalAgentRuntimeDescriptorByProviderId['codex']['home'] {
  return value === 'user' || value === 'connectedService' ? value : null;
}

function readCanonicalCodexProviderExtra(value: unknown) {
  const extra = asRecord(value);
  if (!extra || extra.v !== 1) return null;

  const runtimeAffinity = asRecord(extra.runtimeAffinity);
  if (!runtimeAffinity) return null;

  const home = normalizeCodexHome(runtimeAffinity.home);
  return {
    backendMode: normalizeCodexBackendMode(runtimeAffinity.backendMode),
    vendorSessionId: normalizeTrimmedString(runtimeAffinity.vendorSessionId),
    home,
    connectedServiceId: home === 'connectedService' ? normalizeTrimmedString(runtimeAffinity.connectedServiceId) : null,
    connectedServiceProfileId: home === 'connectedService'
      ? normalizeTrimmedString(runtimeAffinity.connectedServiceProfileId)
      : null,
    connectedServiceGroupId: home === 'connectedService'
      ? normalizeTrimmedString(runtimeAffinity.connectedServiceGroupId)
      : null,
    homePath: normalizeTrimmedString(runtimeAffinity.homePath),
    sqliteHomePath: normalizeTrimmedString(runtimeAffinity.sqliteHomePath),
  };
}

function createAgentRuntimeDescriptorProviderSchema(zod: typeof z) {
  return zod.object({
    providerExtra: createAgentRuntimeDescriptorProviderExtraV1Schema(zod).optional(),
  }).passthrough();
}

function createAgentRuntimeDescriptorProviderExtraV1Schema(zod: typeof z) {
  return zod.object({
    owner: zod.string().min(1),
    schemaId: zod.string().min(1),
    v: zod.number().int().min(1),
  }).passthrough();
}

export function createAgentRuntimeDescriptorV1Schema(zod: typeof z) {
  return zod.object({
    v: zod.literal(1),
    providerId: zod.string().min(1),
    provider: createAgentRuntimeDescriptorProviderSchema(zod),
  }).passthrough();
}

export const AgentRuntimeDescriptorV1Schema = createAgentRuntimeDescriptorV1Schema(z);

function buildCodexRuntimeAffinityProviderExtra(params: Readonly<{
  backendMode: 'mcp' | 'acp' | 'appServer';
  vendorSessionId?: string | null;
  home?: 'user' | 'connectedService' | null;
  connectedServiceId?: string | null;
  connectedServiceProfileId?: string | null;
  connectedServiceGroupId?: string | null;
  homePath?: string | null;
  sqliteHomePath?: string | null;
}>): NonNullable<CodexAgentRuntimeDescriptorProvider['providerExtra']> {
  return {
    owner: 'codex',
    schemaId: 'codex.agentRuntimeDescriptorExtra',
    v: 1,
    runtimeAffinity: {
      backendMode: params.backendMode,
      ...(params.vendorSessionId ? { vendorSessionId: params.vendorSessionId } : {}),
      ...(params.homePath ? { homePath: params.homePath } : {}),
      ...(params.sqliteHomePath ? { sqliteHomePath: params.sqliteHomePath } : {}),
      ...(params.home ? { home: params.home } : {}),
      ...(params.home === 'connectedService' && params.connectedServiceId
        ? { connectedServiceId: params.connectedServiceId }
        : {}),
      ...(params.home === 'connectedService' && params.connectedServiceProfileId
        ? { connectedServiceProfileId: params.connectedServiceProfileId }
        : {}),
      ...(params.home === 'connectedService' && params.connectedServiceGroupId
        ? { connectedServiceGroupId: params.connectedServiceGroupId }
        : {}),
    },
  };
}

export function buildCodexAgentRuntimeDescriptorV1(params: Readonly<{
  backendMode: 'mcp' | 'acp' | 'appServer';
  vendorSessionId?: string | null;
  home?: 'user' | 'connectedService' | null;
  connectedServiceId?: string | null;
  connectedServiceProfileId?: string | null;
  connectedServiceGroupId?: string | null;
  homePath?: string | null;
  sqliteHomePath?: string | null;
}>): CodexAgentRuntimeDescriptorV1 {
  return {
    v: 1,
    providerId: 'codex',
    provider: {
      backendMode: params.backendMode,
      ...(params.vendorSessionId ? { vendorSessionId: params.vendorSessionId } : {}),
      ...(params.homePath ? { homePath: params.homePath } : {}),
      ...(params.home ? { home: params.home } : {}),
      ...(params.home === 'connectedService' && params.connectedServiceId
        ? { connectedServiceId: params.connectedServiceId }
        : {}),
      ...(params.home === 'connectedService' && params.connectedServiceProfileId
        ? { connectedServiceProfileId: params.connectedServiceProfileId }
        : {}),
      ...(params.home === 'connectedService' && params.connectedServiceGroupId
        ? { connectedServiceGroupId: params.connectedServiceGroupId }
        : {}),
      providerExtra: buildCodexRuntimeAffinityProviderExtra(params),
    },
  };
}

export function readAgentRuntimeDescriptorV1(value: unknown): AgentRuntimeDescriptorV1 | null {
  const parsed = AgentRuntimeDescriptorV1Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readAgentRuntimeDescriptorV1ForProvider(value: unknown, providerId: 'codex'): CodexAgentRuntimeDescriptorV1 | null;
export function readAgentRuntimeDescriptorV1ForProvider<TProviderId extends string>(
  value: unknown,
  providerId: TProviderId,
): AgentRuntimeDescriptorEnvelopeV1<TProviderId> | null;
export function readAgentRuntimeDescriptorV1ForProvider<TProviderId extends string>(
  value: unknown,
  providerId: TProviderId,
): AgentRuntimeDescriptorEnvelopeV1<TProviderId> | null {
  const parsed = readAgentRuntimeDescriptorV1(value);
  return parsed?.providerId === providerId ? parsed as AgentRuntimeDescriptorEnvelopeV1<TProviderId> : null;
}

export function readCanonicalAgentRuntimeDescriptorV1ForProvider(
  value: unknown,
  providerId: 'codex',
): CanonicalAgentRuntimeDescriptorByProviderId['codex'] | null;
export function readCanonicalAgentRuntimeDescriptorV1ForProvider(
  value: unknown,
  providerId: 'codex',
) {
  void providerId;
  const descriptor = readAgentRuntimeDescriptorV1ForProvider(value, 'codex');
  if (!descriptor) return null;
  const providerExtra = readCanonicalCodexProviderExtra(descriptor.provider.providerExtra);
  const home = providerExtra?.home ?? normalizeCodexHome(descriptor.provider.home);
  return {
    providerId: 'codex' as const,
    backendMode: providerExtra?.backendMode ?? normalizeCodexBackendMode(descriptor.provider.backendMode),
    vendorSessionId: providerExtra?.vendorSessionId ?? normalizeTrimmedString(descriptor.provider.vendorSessionId),
    home,
    connectedServiceId: providerExtra?.connectedServiceId
      ?? (home === 'connectedService' ? normalizeTrimmedString(descriptor.provider.connectedServiceId) : null),
    connectedServiceProfileId: providerExtra?.connectedServiceProfileId
      ?? (home === 'connectedService' ? normalizeTrimmedString(descriptor.provider.connectedServiceProfileId) : null),
    connectedServiceGroupId: providerExtra?.connectedServiceGroupId
      ?? (home === 'connectedService' ? normalizeTrimmedString(descriptor.provider.connectedServiceGroupId) : null),
    homePath: providerExtra?.homePath ?? normalizeTrimmedString(descriptor.provider.homePath),
    sqliteHomePath: providerExtra?.sqliteHomePath ?? normalizeTrimmedString(descriptor.provider.sqliteHomePath),
  };
}


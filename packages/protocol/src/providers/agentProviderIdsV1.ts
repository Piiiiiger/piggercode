import { z } from 'zod';

// The providers that take part in v1 daemon-facing provider ids (direct sessions, handoff resume plans, MCP detection).
export const AGENT_PROVIDER_IDS_V1 = ['claude', 'codex'] as const;

export type AgentProviderIdV1 = (typeof AGENT_PROVIDER_IDS_V1)[number];

export const AgentProviderIdV1Schema = z.enum(AGENT_PROVIDER_IDS_V1);

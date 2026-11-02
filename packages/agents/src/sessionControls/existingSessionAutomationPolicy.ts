import { resolveAgentIdFromSessionMetadata } from '../resolveAgentIdFromSessionMetadata.js';
import type { AgentId } from '../types.js';
import {
  evaluateVendorResumeEligibility,
  type VendorResumeEligibilityReasonCode,
} from './vendorResumePolicy.js';

export type ExistingSessionAutomationEligibilityReasonCode =
  | VendorResumeEligibilityReasonCode
  | 'agent_unknown';

export type ExistingSessionAutomationEligibility =
  | Readonly<{ eligible: true; agentId: AgentId; strategy: 'vendor_resume' | 'happy_attach' }>
  | Readonly<{ eligible: false; reasonCode: ExistingSessionAutomationEligibilityReasonCode }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function resolveAgentIdFromMetadata(metadata: Record<string, unknown>): AgentId | null {
  return resolveAgentIdFromSessionMetadata(metadata);
}

export function evaluateExistingSessionAutomationEligibility(input: Readonly<{
  metadata: unknown;
  accountSettings?: Record<string, unknown> | null;
}>): ExistingSessionAutomationEligibility {
  const metadata = asRecord(input.metadata);
  if (!metadata) {
    return { eligible: false, reasonCode: 'agent_unknown' };
  }

  const agentId = resolveAgentIdFromMetadata(metadata);
  if (!agentId) {
    return { eligible: false, reasonCode: 'agent_unknown' };
  }

  const eligibility = evaluateVendorResumeEligibility({
    agentId,
    metadata,
    accountSettings: input.accountSettings ?? null,
  });
  if (!eligibility.eligible) {
    return eligibility;
  }

  return {
    eligible: true,
    agentId,
    strategy: 'vendor_resume',
  };
}

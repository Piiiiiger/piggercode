import type {
  ConnectedServiceAuthGroupQuotaLimitSelectionV1,
} from '@piggercode/protocol';
import { selectConnectedServiceQuotaMetersForLimitSelection } from '@piggercode/protocol';

function readIdentity(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function includesConnectedServiceProviderLimit(
  selection: ConnectedServiceAuthGroupQuotaLimitSelectionV1 | undefined,
  providerLimitId: string | null | undefined,
): boolean {
  if (!selection || selection.mode === 'all') return true;
  const normalized = readIdentity(providerLimitId);
  return normalized === null || selection.providerLimitIds.includes(normalized);
}

export function shouldHandleConnectedServiceProviderLimitFailure(input: Readonly<{
  selection?: ConnectedServiceAuthGroupQuotaLimitSelectionV1;
  reason: string;
  providerLimitId?: string | null;
}>): boolean {
  if (input.reason !== 'usage_limit' && input.reason !== 'rate_limit' && input.reason !== 'same_provider_account_exhausted') {
    return true;
  }
  return includesConnectedServiceProviderLimit(input.selection, input.providerLimitId);
}

export const selectConnectedServiceAuthGroupQuotaMeters = selectConnectedServiceQuotaMetersForLimitSelection;

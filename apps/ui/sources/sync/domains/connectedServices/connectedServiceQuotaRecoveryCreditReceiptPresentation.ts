import type { ConnectedServiceQuotaRecoveryCreditConsumeReceiptStatusV1 } from '@piggercode/protocol';

export function resolveConnectedServiceQuotaRecoveryCreditReceiptNoticeKey(
    status: ConnectedServiceQuotaRecoveryCreditConsumeReceiptStatusV1,
): 'connectedServices.quota.recoveryCreditNothingToReset' | null {
    return status === 'nothing_to_reset'
        ? 'connectedServices.quota.recoveryCreditNothingToReset'
        : null;
}

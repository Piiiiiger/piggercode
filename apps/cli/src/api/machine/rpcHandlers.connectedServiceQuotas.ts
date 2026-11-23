import {
  ConnectedServiceQuotaRecoveryCreditConsumeRequestV1Schema,
  ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema,
  type ConnectedServiceQuotaRecoveryCreditConsumeRequestV1,
  type ConnectedServiceQuotaRecoveryCreditConsumeResponseV1,
  type ConnectedServiceQuotaRefreshResponseV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import { notifyDaemonConnectedServiceQuotaRecoveryCreditConsume } from '@/daemon/controlClient';

import type { RpcHandlerRegistrar } from '../rpc/types';

type ConsumeConnectedServiceQuotaRecoveryCredit = (
  request: ConnectedServiceQuotaRecoveryCreditConsumeRequestV1,
) => Promise<unknown>;

export type RegisterMachineConnectedServiceQuotaRpcHandlersDeps = Readonly<{
  consumeConnectedServiceQuotaRecoveryCredit?: ConsumeConnectedServiceQuotaRecoveryCredit;
  /** Resolves false when this machine could not run a usage round or store its readings. */
  refreshConnectedServiceQuota?: () => Promise<boolean>;
}>;

function invalidParameters(): ConnectedServiceQuotaRecoveryCreditConsumeResponseV1 {
  return {
    ok: false,
    errorCode: 'invalid_parameters',
    error: 'invalid_parameters',
  };
}

function transportFailure(error: string, errorCode?: string): ConnectedServiceQuotaRecoveryCreditConsumeResponseV1 {
  return {
    ok: false,
    errorCode: typeof errorCode === 'string' && errorCode.trim().length > 0
      ? errorCode.trim()
      : 'daemon_control_failed',
    error,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function normalizeConsumeResult(value: unknown): ConnectedServiceQuotaRecoveryCreditConsumeResponseV1 {
  const routeResult = isRecord(value) && value.ok === true && Object.prototype.hasOwnProperty.call(value, 'result')
    ? value.result
    : value;
  const parsed = ConnectedServiceQuotaRecoveryCreditConsumeResponseV1Schema.safeParse(routeResult);
  if (parsed.success) return parsed.data;
  if (isRecord(value) && typeof value.error === 'string') {
    return transportFailure(value.error, typeof value.errorCode === 'string' ? value.errorCode : undefined);
  }
  return transportFailure('invalid_daemon_response', 'invalid_daemon_response');
}

export function registerMachineConnectedServiceQuotaRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  deps?: RegisterMachineConnectedServiceQuotaRpcHandlersDeps;
}>): void {
  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_RECOVERY_CREDIT_CONSUME,
    async (raw: unknown) => {
      const parsed = ConnectedServiceQuotaRecoveryCreditConsumeRequestV1Schema.safeParse(raw);
      if (!parsed.success) return invalidParameters();
      const consume = params.deps?.consumeConnectedServiceQuotaRecoveryCredit
        ?? notifyDaemonConnectedServiceQuotaRecoveryCreditConsume;
      return normalizeConsumeResult(await consume(parsed.data));
    },
  );
  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_CONNECTED_SERVICE_QUOTA_REFRESH,
    async (): Promise<ConnectedServiceQuotaRefreshResponseV1> => {
      const refreshed = await params.deps?.refreshConnectedServiceQuota?.();
      return refreshed ? { ok: true } : { ok: false, errorCode: 'connected_service_quota_refresh_unavailable' };
    },
  );
}

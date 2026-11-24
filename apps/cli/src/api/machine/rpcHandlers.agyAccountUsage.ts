import {
  AGY_ACCOUNT_LOGIN_REQUIRES_ENCRYPTION,
  AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION,
  AgyAccountLoginRequestV1Schema,
  AgyAccountUsageReadRequestV1Schema,
  type AgyAccountLoginResponseV1,
  type AgyAccountUsageReadResponseV1,
  type AgyAccountUsageV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';

import type { AgyAccountLogins } from '@/backends/agy/accounts/agyAccountLogin';
import { logger } from '@/ui/logger';

import type { RpcHandlerRegistrar } from '../rpc/types';

export type RegisterMachineAgyAccountUsageRpcHandlersDeps = Readonly<{
  readAgyAccountUsage?: () => Promise<readonly AgyAccountUsageV1[]>;
  /** The refresh button: starts agy once on this login. */
  refreshAgyAccountUsage?: (accountId: string) => Promise<boolean>;
  /** Only an end-to-end encrypted machine may send the usage: the relay can read a plain machine's RPC. */
  isMachineEndToEndEncrypted?: () => boolean;
  /** Adding a Google login to agy from the app. */
  agyAccountLogins?: AgyAccountLogins;
}>;

export function registerMachineAgyAccountUsageRpcHandlers(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  deps?: RegisterMachineAgyAccountUsageRpcHandlersDeps;
}>): void {
  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_AGY_ACCOUNT_USAGE_READ,
    async (raw: unknown): Promise<AgyAccountUsageReadResponseV1> => {
      const request = AgyAccountUsageReadRequestV1Schema.safeParse(raw ?? {});
      if (!request.success) return { ok: false, errorCode: 'invalid_parameters' };
      const read = params.deps?.readAgyAccountUsage;
      if (!read) return { ok: false, errorCode: 'agy_account_usage_unavailable' };
      const encrypted = params.deps?.isMachineEndToEndEncrypted?.() === true;

      // A plain machine could not send the result, so a press starts nothing there.
      const { refreshAccountId } = request.data;
      const refreshed = refreshAccountId && encrypted
        ? await params.deps?.refreshAgyAccountUsage?.(refreshAccountId).catch(() => false) ?? false
        : undefined;

      // By its code: the error's text names a local path, and a plain machine's RPC is readable on the relay.
      const accounts = await read().catch(() => null);
      if (!accounts) return { ok: false, errorCode: 'agy_account_usage_read_failed' };
      if (!encrypted) {
        return accounts.some((account) => account.observedAtMs !== null)
          ? { ok: false, errorCode: AGY_ACCOUNT_USAGE_REQUIRES_ENCRYPTION }
          : { ok: true, accounts: [] };
      }
      return { ok: true, accounts: [...accounts], ...(refreshed === undefined ? {} : { refreshed }) };
    },
  );

  params.rpcHandlerManager.registerHandler(
    RPC_METHODS.DAEMON_AGY_ACCOUNT_LOGIN,
    async (raw: unknown): Promise<AgyAccountLoginResponseV1> => {
      const request = AgyAccountLoginRequestV1Schema.safeParse(raw ?? {});
      if (!request.success) return { ok: false, errorCode: 'invalid_parameters' };
      const logins = params.deps?.agyAccountLogins;
      if (!logins) return { ok: false, errorCode: 'agy_account_login_unavailable' };
      // The code the person pastes travels in this RPC, which the relay can read on a plain machine.
      if (params.deps?.isMachineEndToEndEncrypted?.() !== true) {
        return { ok: false, errorCode: AGY_ACCOUNT_LOGIN_REQUIRES_ENCRYPTION };
      }
      try {
        const action = request.data;
        if (action.action === 'start') {
          const started = await logins.start();
          return started.ok
            ? { ok: true, action: 'start', loginId: started.loginId, accountId: started.accountId, url: started.url }
            : started;
        }
        if (action.action === 'submit') {
          const submitted = await logins.submit(action.loginId, action.code);
          return submitted.ok ? { ok: true, action: 'submit', accountId: submitted.accountId } : submitted;
        }
        await logins.cancel(action.loginId);
        return { ok: true, action: 'cancel' };
      } catch (error) {
        // Answered by its code: the error's text names local paths.
        logger.infoFile('[agy-accounts] Adding a login failed', error instanceof Error ? error.message : String(error));
        return { ok: false, errorCode: 'login_failed' };
      }
    },
  );
}

import {
  ConnectedServiceLoginUseRequestV1Schema,
  type ConnectedServiceLoginUseRequestV1,
  type ConnectedServiceLoginUseResponseV1,
} from '@piggercode/protocol';
import { RPC_METHODS } from '@piggercode/protocol/rpc';
import type { RpcHandlerRegistrar } from '../rpc/types';

export type DescribeConnectedServiceLoginUse = (
  request: ConnectedServiceLoginUseRequestV1,
) => Promise<ConnectedServiceLoginUseResponseV1>;

/** Lets the app ask the managing machine whether deleting a login now could lose its latest token. */
export function registerMachineConnectedServiceLoginUseRpcHandler(params: Readonly<{
  rpcHandlerManager: RpcHandlerRegistrar;
  describeLoginUse?: DescribeConnectedServiceLoginUse;
}>): void {
  params.rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_CONNECTED_SERVICE_LOGIN_USE, async (
    raw: unknown,
  ): Promise<ConnectedServiceLoginUseResponseV1> => {
    const parsed = ConnectedServiceLoginUseRequestV1Schema.safeParse(raw);
    if (!parsed.success) return { status: 'unknown', reason: 'invalid_request' };
    if (!params.describeLoginUse) return { status: 'unknown', reason: 'not_managing_machine' };
    return await params.describeLoginUse(parsed.data);
  });
}

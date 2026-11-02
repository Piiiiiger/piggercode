export type { RpcErrorCode } from '@piggercode/protocol/rpc';
export {
  createRpcCallError,
  isRpcMethodNotAvailableError,
  isRpcMethodNotFoundError,
  readRpcErrorCode,
  RpcError,
  type RpcErrorCarrier,
} from '@piggercode/protocol/rpcErrors';

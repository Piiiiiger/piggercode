import type {
  ActionOperationCancelV1Response,
  ActionOperationScopeV1,
} from '@piggercode/protocol';

export type ActionOperationAccessScope = Pick<ActionOperationScopeV1, 'accountId' | 'machineId'>;

export type ActionOperationExecutionRequest = Readonly<{
  actionId: string;
  input: unknown;
  requestId?: string;
  scope: Readonly<{ sessionId?: string }>;
}>;

export type ActionOperationCancelResult = ActionOperationCancelV1Response;

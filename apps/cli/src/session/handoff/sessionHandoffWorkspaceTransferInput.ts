import type { SessionHandoffWorkspaceTransfer } from '@piggercode/protocol';

export type SessionHandoffWorkspaceTransferInput = Readonly<
  Omit<SessionHandoffWorkspaceTransfer, 'strategy'> & {
    strategy?: SessionHandoffWorkspaceTransfer['strategy'];
  }
>;

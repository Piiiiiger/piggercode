import { z } from 'zod';
import { ConnectedServiceIdSchema, ConnectedServiceProfileIdSchema } from './connectedServiceBindings.js';

/** Asked of the account's managing machine before a connected login is deleted. */
export const ConnectedServiceLoginUseRequestV1Schema = z.object({
  serviceId: ConnectedServiceIdSchema,
  profileId: ConnectedServiceProfileIdSchema,
}).strict();
export type ConnectedServiceLoginUseRequestV1 = z.infer<typeof ConnectedServiceLoginUseRequestV1Schema>;

/**
 * `in_use`: deleting now could lose the login's latest token (a terminal owns it, a rotation is in
 * flight, or a rotation is not read back yet). `unknown`: this machine does not manage the login.
 */
export const ConnectedServiceLoginUseResponseV1Schema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('free') }).strict(),
  z.object({ status: z.literal('in_use'), reason: z.enum(['terminal', 'refreshing', 'rotation_not_read_back']) }).strict(),
  z.object({ status: z.literal('unknown'), reason: z.enum(['not_managing_machine', 'settings_unconfirmed', 'invalid_request']) }).strict(),
]);
export type ConnectedServiceLoginUseResponseV1 = z.infer<typeof ConnectedServiceLoginUseResponseV1Schema>;

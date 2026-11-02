import { z } from 'zod';

/**
 * Canonical, cross-surface input contract for starting reviews.
 *
 * This is not a “backend contract”. It is a generalized review intent input that
 * is interpreted by the selected agents.
 */

export const ReviewChangeTypeSchema = z.enum(['all', 'committed', 'uncommitted']);
export type ReviewChangeType = z.infer<typeof ReviewChangeTypeSchema>;

export const ReviewBaseSchema = z.union([
  z.object({ kind: z.literal('none') }).passthrough(),
  z.object({ kind: z.literal('branch'), baseBranch: z.string().min(1) }).passthrough(),
  z.object({ kind: z.literal('commit'), baseCommit: z.string().min(1) }).passthrough(),
]);
export type ReviewBase = z.infer<typeof ReviewBaseSchema>;

export const ReviewEngineIdSchema = z.string().trim().min(1);
export type ReviewEngineId = z.infer<typeof ReviewEngineIdSchema>;

export const ReviewRunLocationSchema = z.enum(['execution_run', 'current_session']);
export type ReviewRunLocation = z.infer<typeof ReviewRunLocationSchema>;

export const ReviewStartInputSchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    engineIds: z.array(ReviewEngineIdSchema).min(1),
    instructions: z.string().trim().default(''),
    runLocation: ReviewRunLocationSchema.default('execution_run'),
    // Intentionally default to uncommitted changes: the common "review what I just changed"
    // flow should stay narrowly scoped unless the user explicitly broadens it.
    changeType: ReviewChangeTypeSchema.default('uncommitted'),
    base: ReviewBaseSchema.default({ kind: 'none' }),
    permissionMode: z.string().min(1).default('read_only'),
  })
  .passthrough();
export type ReviewStartInput = z.infer<typeof ReviewStartInputSchema>;

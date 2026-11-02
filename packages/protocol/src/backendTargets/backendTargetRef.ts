import { z } from 'zod';

export const BackendTargetKindSchema = z.enum(['builtInAgent']);
export type BackendTargetKind = z.infer<typeof BackendTargetKindSchema>;

const BuiltInAgentTargetSchema = z.object({
  kind: z.literal('builtInAgent'),
  agentId: z.string().min(1),
});

export const BackendTargetRefSchema = BuiltInAgentTargetSchema;
export type BackendTargetRefV1 = z.infer<typeof BackendTargetRefSchema>;

export function matchesBackendTargetAgentId(target: BackendTargetRefV1, agentId: string): boolean {
  return agentId === target.agentId;
}

export const BackendTargetKeySchema = z.string().regex(/^agent:.+$/, 'Invalid backend target key');
export type BackendTargetKey = z.infer<typeof BackendTargetKeySchema>;

export function buildBackendTargetKey(target: BackendTargetRefV1): BackendTargetKey {
  return BackendTargetKeySchema.parse(`agent:${target.agentId}`);
}

export function parseBackendTargetKey(key: string): BackendTargetRefV1 {
  const parsed = BackendTargetKeySchema.parse(key);
  return BackendTargetRefSchema.parse({ kind: 'builtInAgent', agentId: parsed.slice('agent:'.length) });
}

export function isBuiltInAgentTarget(target: BackendTargetRefV1): target is z.infer<typeof BuiltInAgentTargetSchema> {
  return target.kind === 'builtInAgent';
}

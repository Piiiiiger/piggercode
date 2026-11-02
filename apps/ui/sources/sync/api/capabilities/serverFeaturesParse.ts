import { FeaturesResponseSchema, type FeaturesResponse as ServerFeatures } from '@piggercode/protocol';

export function parseServerFeatures(raw: unknown): ServerFeatures | null {
    const parsed = FeaturesResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

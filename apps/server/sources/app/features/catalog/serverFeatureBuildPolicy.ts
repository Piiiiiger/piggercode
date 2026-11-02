import {
    resolveEmbeddedFeaturePolicyEnv,
    resolveFeatureBuildPolicyFromEnvOrEmbedded,
    type FeatureBuildPolicy,
} from "@piggercode/protocol";

type Cached = Readonly<{
    key: string;
    policy: FeatureBuildPolicy;
}>;

let cached: Cached | null = null;

function buildCacheKey(env: NodeJS.ProcessEnv): string {
    const embeddedEnv = resolveEmbeddedFeaturePolicyEnv(
      env.PIGGERCODE_FEATURE_POLICY_ENV ?? env.PIGGERCODE_EMBEDDED_POLICY_ENV,
    ) ?? "";
    const allow = String(env.PIGGERCODE_BUILD_FEATURES_ALLOW ?? "");
    const deny = String(env.PIGGERCODE_BUILD_FEATURES_DENY ?? "");
    return `${embeddedEnv}\n${allow}\n${deny}`;
}

export function resolveServerFeatureBuildPolicy(env: NodeJS.ProcessEnv): FeatureBuildPolicy {
    const key = buildCacheKey(env);
    if (cached?.key === key) return cached.policy;

    const policy = resolveFeatureBuildPolicyFromEnvOrEmbedded({
        embeddedEnv: resolveEmbeddedFeaturePolicyEnv(
          env.PIGGERCODE_FEATURE_POLICY_ENV ?? env.PIGGERCODE_EMBEDDED_POLICY_ENV,
        ) ?? undefined,
        allowRaw: env.PIGGERCODE_BUILD_FEATURES_ALLOW,
        denyRaw: env.PIGGERCODE_BUILD_FEATURES_DENY,
    });

    cached = { key, policy };
    return policy;
}

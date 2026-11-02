import {
  evaluateFeatureBuildPolicy,
  resolveEmbeddedFeaturePolicyEnv,
  resolveFeatureBuildPolicyFromEnvOrEmbedded,
  type FeatureBuildPolicyEvaluation,
  type FeatureId,
} from '@piggercode/protocol';

export function getCliFeatureBuildPolicyDecision(featureId: FeatureId, env: NodeJS.ProcessEnv): FeatureBuildPolicyEvaluation {
  const embeddedEnv = resolveEmbeddedFeaturePolicyEnv(
    env.PIGGERCODE_FEATURE_POLICY_ENV ?? env.PIGGERCODE_EMBEDDED_POLICY_ENV,
  );
  const policy = resolveFeatureBuildPolicyFromEnvOrEmbedded({
    embeddedEnv: embeddedEnv ?? undefined,
    allowRaw: env.PIGGERCODE_BUILD_FEATURES_ALLOW,
    denyRaw: env.PIGGERCODE_BUILD_FEATURES_DENY,
  });

  return evaluateFeatureBuildPolicy(policy, featureId);
}

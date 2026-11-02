import { BUG_REPORT_DEFAULT_ACCEPTED_ARTIFACT_KINDS, normalizeBugReportProviderUrl } from "@piggercode/protocol";
import type { FeaturesPayloadDelta } from "./types";
import { readBugReportsFeatureEnv } from "./catalog/readFeatureEnv";

const DEFAULT_ACCEPTED_KINDS = [...BUG_REPORT_DEFAULT_ACCEPTED_ARTIFACT_KINDS];
const DEFAULT_CONTEXT_WINDOW_MS = 30 * 60 * 1000;

function parseAcceptedKinds(raw: string | undefined): string[] {
    const value = (raw ?? "").trim();
    if (!value) return DEFAULT_ACCEPTED_KINDS;
    const parts = Array.from(
        new Set(
            value
                .split(",")
                .map((part) => part.trim().toLowerCase())
                .filter(Boolean),
        ),
    );
    return parts.length > 0 ? parts : DEFAULT_ACCEPTED_KINDS;
}

export function resolveBugReportsFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    const config = readBugReportsFeatureEnv(env);
    // Reports go nowhere unless this relay names a provider: this fork has no hosted report service.
    const providerUrlRaw = (config.providerUrlRaw ?? "").trim();
    const providerUrl = normalizeBugReportProviderUrl(providerUrlRaw);

    const defaultIncludeDiagnostics = config.defaultIncludeDiagnostics;
    const maxArtifactBytes = config.maxArtifactBytes;
    const uploadTimeoutMs = config.uploadTimeoutMs;
    const contextWindowMs = config.contextWindowMs;
    const acceptedArtifactKinds = parseAcceptedKinds(config.acceptedArtifactKindsRaw);

    const enabled = config.enabled && Boolean(providerUrl);

    return {
        features: {
            bugReports: { enabled },
        },
        capabilities: {
            bugReports: {
                providerUrl,
                defaultIncludeDiagnostics,
                maxArtifactBytes,
                acceptedArtifactKinds,
                uploadTimeoutMs,
                contextWindowMs,
            },
        },
    };
}

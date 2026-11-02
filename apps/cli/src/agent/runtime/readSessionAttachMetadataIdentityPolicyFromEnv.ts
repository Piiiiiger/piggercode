import {
    SessionAttachMetadataIdentityPolicySchema,
    type SessionAttachMetadataIdentityPolicy,
} from '@piggercode/protocol';

export function readSessionAttachMetadataIdentityPolicyFromEnv(): SessionAttachMetadataIdentityPolicy | null {
    const raw = typeof process.env.PIGGERCODE_SESSION_ATTACH_METADATA_IDENTITY_POLICY === 'string'
        ? process.env.PIGGERCODE_SESSION_ATTACH_METADATA_IDENTITY_POLICY.trim()
        : '';
    delete process.env.PIGGERCODE_SESSION_ATTACH_METADATA_IDENTITY_POLICY;
    if (!raw) {
        return null;
    }
    const parsed = SessionAttachMetadataIdentityPolicySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

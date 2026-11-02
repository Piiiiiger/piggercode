import {
    CURRENT_PENDING_INPUT_PROTOCOL_VERSION,
    SESSION_SYNC_PROTOCOL_VERSION_RUNTIME_ACTIVITY,
} from '@piggercode/protocol';

import type { FeaturesPayloadDelta } from './types';

export function resolveSessionProtocolCapabilitiesFeature(): FeaturesPayloadDelta {
    return {
        capabilities: {
            session: {
                runtimeActivity: {
                    protocolVersion: SESSION_SYNC_PROTOCOL_VERSION_RUNTIME_ACTIVITY,
                },
                pendingInput: {
                    protocolVersion: CURRENT_PENDING_INPUT_PROTOCOL_VERSION,
                },
            },
        },
    };
}

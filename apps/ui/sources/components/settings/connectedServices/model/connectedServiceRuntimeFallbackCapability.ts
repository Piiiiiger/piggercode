import {
    isConnectedServiceAccountGroupConfigurationSupported,
    isConnectedServiceRuntimeFallbackSupported,
    resolveConnectedServiceRuntimeFallbackCapability,
} from '@piggercode/agents';
import type { ConnectedServiceId } from '@piggercode/protocol';

export function resolveConnectedServiceRuntimeGroupCapability(serviceId: ConnectedServiceId) {
    return resolveConnectedServiceRuntimeFallbackCapability(serviceId);
}

export function isConnectedServiceAccountGroupConfigurationRuntimeSupported(serviceId: ConnectedServiceId): boolean {
    return isConnectedServiceAccountGroupConfigurationSupported(serviceId);
}

export function isConnectedServiceRuntimeGroupFallbackSupported(serviceId: ConnectedServiceId): boolean {
    return isConnectedServiceRuntimeFallbackSupported(serviceId);
}

import { requireOptionalNativeModule } from 'expo-modules-core';

import type { HappierAudioStreamNativeModule } from './HappierAudioStreamNative.types';

export const PIGGERCODE_AUDIO_STREAM_NATIVE_MODULE_NAME = 'HappierAudioStreamNative';

export function getOptionalHappierAudioStreamNativeModule(): HappierAudioStreamNativeModule | null {
  const mod = requireOptionalNativeModule(PIGGERCODE_AUDIO_STREAM_NATIVE_MODULE_NAME) as HappierAudioStreamNativeModule | null;
  return mod ?? null;
}


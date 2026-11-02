import { requireOptionalNativeModule } from 'expo-modules-core';

import type { SherpaNativeModule } from './HappierSherpaNative.types';

export const PIGGERCODE_SHERPA_NATIVE_MODULE_NAME = 'HappierSherpaNative';

export function getOptionalHappierSherpaNativeModule(): SherpaNativeModule | null {
  const mod = requireOptionalNativeModule(PIGGERCODE_SHERPA_NATIVE_MODULE_NAME) as SherpaNativeModule | null;
  return mod ?? null;
}

import { describe, expect, it } from 'vitest';

import {
  filterProviderIdsForScenarioSelection,
  parseMaxParallel,
  resolveProviderPresetIds,
} from '../../src/testkit/providers/presets/presets';

describe('providers: parallel preset helpers', () => {

  it('returns null for unknown preset', () => {
    expect(resolveProviderPresetIds('unknown')).toBeNull();
  });

  it('parses max parallel with defaults and bounds', () => {
    expect(parseMaxParallel(undefined)).toBe(4);
    expect(parseMaxParallel('')).toBe(4);
    expect(parseMaxParallel('1')).toBe(1);
    expect(parseMaxParallel('4')).toBe(4);
    expect(parseMaxParallel('5')).toBe(5);
    expect(parseMaxParallel('0')).toBeNull();
    expect(parseMaxParallel('-2')).toBeNull();
    expect(parseMaxParallel('nope')).toBeNull();
  });

  it('does not filter providers for mixed or empty scenario selection', () => {
    const providerIds = resolveProviderPresetIds('all');
    expect(providerIds).not.toBeNull();
    expect(filterProviderIdsForScenarioSelection(providerIds!, '')).toEqual(providerIds);
    expect(filterProviderIdsForScenarioSelection(providerIds!, 'read_known_file,acp_probe_models')).toEqual(providerIds);
  });
});

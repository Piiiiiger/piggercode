export const PROVIDER_ENV_FLAG_BY_PRESET_ID = Object.freeze({
  opencode: 'PIGGERCODE_E2E_PROVIDER_OPENCODE',
  opencode_server: 'PIGGERCODE_E2E_PROVIDER_OPENCODE_SERVER',
  claude: 'PIGGERCODE_E2E_PROVIDER_CLAUDE',
  codex: 'PIGGERCODE_E2E_PROVIDER_CODEX',
  kilo: 'PIGGERCODE_E2E_PROVIDER_KILO',
  gemini: 'PIGGERCODE_E2E_PROVIDER_GEMINI',
  qwen: 'PIGGERCODE_E2E_PROVIDER_QWEN',
  kimi: 'PIGGERCODE_E2E_PROVIDER_KIMI',
  auggie: 'PIGGERCODE_E2E_PROVIDER_AUGGIE',
  pi: 'PIGGERCODE_E2E_PROVIDER_PI',
  cursor: 'PIGGERCODE_E2E_PROVIDER_CURSOR',
  copilot: 'PIGGERCODE_E2E_PROVIDER_COPILOT',
  grok: 'PIGGERCODE_E2E_PROVIDER_GROK',
});

export const PROVIDER_PRESET_IDS = Object.freeze(Object.keys(PROVIDER_ENV_FLAG_BY_PRESET_ID));
export const ACP_PROVIDER_PRESET_IDS = Object.freeze(PROVIDER_PRESET_IDS.filter((id) => id !== 'claude'));

export function resolveProviderPresetIds(id) {
  if (id === 'all') return [...PROVIDER_PRESET_IDS];
  if (PROVIDER_PRESET_IDS.includes(id)) return [id];
  return null;
}

export function parseMaxParallel(raw, fallback = 4) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export function parseScenarioSelection(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isAcpOnlyScenarioSelection(scenarioIds) {
  return Array.isArray(scenarioIds) && scenarioIds.length > 0 && scenarioIds.every((id) => id.startsWith('acp_'));
}

export function filterProviderIdsForScenarioSelection(providerIds, scenarioSelectionRaw) {
  if (!Array.isArray(providerIds)) return [];

  const scenarioIds = parseScenarioSelection(scenarioSelectionRaw);
  if (!isAcpOnlyScenarioSelection(scenarioIds)) return [...providerIds];

  const filtered = providerIds.filter((providerId) => ACP_PROVIDER_PRESET_IDS.includes(providerId));
  return filtered.length > 0 ? filtered : [...providerIds];
}

export function resolveProviderRunPreset(id, tier) {
  const providerIds = resolveProviderPresetIds(id);
  if (!providerIds) return null;
  if (tier !== 'smoke' && tier !== 'extended') return null;

  const env = {
    PIGGERCODE_E2E_PROVIDERS: '1',
    PIGGERCODE_E2E_PROVIDER_SCENARIO_TIER: tier,
  };

  for (const envVar of Object.values(PROVIDER_ENV_FLAG_BY_PRESET_ID)) {
    env[envVar] = '0';
  }

  for (const providerId of providerIds) {
    const envVar = PROVIDER_ENV_FLAG_BY_PRESET_ID[providerId];
    if (envVar) {
      env[envVar] = '1';
    }
  }

  return {
    id,
    tier,
    title: `providers:${id}:${tier}`,
    env,
  };
}

import { AGENTS_CORE, hasBuiltInAcpConfig, type AgentId } from '@piggercode/agents';

import type { ProviderScenario, ProviderUnderTest } from '../types';

export function assertProviderId(provider: ProviderUnderTest, expected: ProviderUnderTest['id']): void {
  if (provider.id !== expected) throw new Error(`Scenario is only supported for provider ${expected} (got ${provider.id})`);
}

export function acpProviderId(provider: ProviderUnderTest): string {
  return provider.traceProvider ?? provider.id;
}

function isAgentId(value: string): value is AgentId {
  return Object.prototype.hasOwnProperty.call(AGENTS_CORE, value);
}

export function acpResumeMetadataKey(providerId: ProviderUnderTest['id']): string {
  if (isAgentId(providerId)) {
    const field = AGENTS_CORE[providerId].resume.vendorResumeIdField;
    if (field) return field;
  }
  return 'codexSessionId';
}

export function claudeAgentTeamsCreateAndSpawnPrompt(teamId: string): string {
  return [
    'This is an automated E2E test for Claude Code Agent Teams.',
    'You MUST execute the following tool calls, in order:',
    '',
    `1) TeamCreate: create a team with team_name="${teamId}".`,
    '2) Task: spawn teammate Alpha (run_in_background=true).',
    '3) Task: spawn teammate Beta (run_in_background=true).',
    '',
    'Rules:',
    '- Do not use Bash.',
    '- Do not read or write files.',
    '- Do not answer until steps 1–3 are complete.',
    '- Then reply DONE.',
    '',
    'If you do not see the TeamCreate tool available, reply ONLY: NO_AGENT_TEAMS.',
  ].join('\n');
}

export function abortContinuationFollowupSubstrings(
  providerId: ProviderUnderTest['id'],
  followupSentinel: string,
  memorySentinel: string,
): string[] {
  return [followupSentinel, memorySentinel];
}

export function tuneResumeScenarioForProvider(provider: ProviderUnderTest, scenario: ProviderScenario): ProviderScenario {
  if (
    scenario.id === 'acp_resume_fresh_session_imports_history'
    && isAgentId(provider.id)
    && hasBuiltInAcpConfig(provider.id)
  ) {
    throw new Error(`Provider ${provider.id} uses ordinary resume without native history import; this scenario requires an explicit history-import entrypoint`);
  }
  if (provider.id !== 'codex') return scenario;
  return {
    ...scenario,
    inactivityTimeoutMs: 240_000,
  };
}

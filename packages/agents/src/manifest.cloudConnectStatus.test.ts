import { describe, expect, it } from 'vitest';

import { AGENTS_CORE } from './manifest';

describe('AGENTS_CORE cloudConnect status', () => {
  it('marks codex and claude connect targets as wired', () => {
    expect(AGENTS_CORE.codex.cloudConnect?.status).toBe('wired');
    expect(AGENTS_CORE.claude.cloudConnect?.status).toBe('wired');
  });

  it('advertises session auth switching for providers with implemented switch continuity', () => {
    expect(AGENTS_CORE.claude.connectedServices?.sessionAuthSwitch).toEqual({
      continuityMode: 'restart_same_home',
      supportedTransitions: ['same_connected_group'],
      providerStateSharingRequired: {
        serviceIds: ['claude-subscription', 'anthropic'],
        supportedTransitions: ['native_to_connected', 'connected_to_native', 'connected_to_connected'],
      },
    });
    expect(AGENTS_CORE.codex.connectedServices?.sessionAuthSwitch).toEqual({
      continuityMode: 'restart_shared_state_required',
      supportedTransitions: ['same_connected_group'],
      providerStateSharingRequired: {
        serviceIds: ['openai-codex'],
        supportedTransitions: ['native_to_connected', 'connected_to_native', 'connected_to_connected'],
      },
    });
  });

  it('advertises Codex provider state sharing capabilities from the shared catalog', () => {
    expect(AGENTS_CORE.codex.connectedServices?.providerStateSharing).toEqual({
      config: {
        supported: true,
        modes: ['linked', 'copied', 'isolated'],
      },
      state: {
        supported: true,
        modes: ['isolated', 'shared'],
        sharedStatePrivacyRiskAcknowledgementRequired: true,
      },
    });
  });

  it('advertises Claude provider state sharing capabilities from the shared catalog', () => {
    expect(AGENTS_CORE.claude.connectedServices?.providerStateSharing).toEqual({
      config: {
        supported: true,
        modes: ['linked', 'copied', 'isolated'],
      },
      state: {
        supported: true,
        modes: ['isolated', 'shared'],
        sharedStatePrivacyRiskAcknowledgementRequired: true,
      },
    });
  });

});

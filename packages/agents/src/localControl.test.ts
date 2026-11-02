import { describe, expect, it } from 'vitest';

import {
  getAgentLocalControlCapability,
  getAgentLocalControlCapabilityForSession,
  usesProviderAttachForLocalControl,
} from './localControl';

describe('agent local control capability', () => {

  it('exposes tmux-backed exclusive local control for claude', () => {
    expect(getAgentLocalControlCapability('claude')).toEqual({
      supported: true,
      topology: 'exclusive',
      attachStrategy: 'tmux',
    });
    expect(usesProviderAttachForLocalControl('claude')).toBe(false);
  });

  it('projects Codex local control from the persisted runtime kind', () => {
    expect(getAgentLocalControlCapabilityForSession({
      agentId: 'codex',
      metadata: { codexBackendMode: 'appServer' },
    })).toEqual({
      supported: true,
      topology: 'shared',
      attachStrategy: 'provider_attach',
    });
    expect(getAgentLocalControlCapabilityForSession({
      agentId: 'codex',
      metadata: { codexBackendMode: 'acp' },
    })).toEqual({
      supported: true,
      topology: 'exclusive',
      attachStrategy: 'tmux',
    });
  });

});

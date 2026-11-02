import { describe, expect, it } from 'vitest';

import { AGENT_IDS } from './types.js';
import { AGENT_MODEL_CONFIG, getAgentModelConfig, getAgentStaticModels } from './models.js';
import { CURRENT_FLAGSHIP_CLAUDE_MODEL_ID } from './providers/claude/flagshipModel.js';


describe('agent model config', () => {
  it('covers every canonical agent', () => {
    expect(Object.keys(AGENT_MODEL_CONFIG).sort()).toEqual([...AGENT_IDS].sort());
    for (const agentId of AGENT_IDS) {
      expect(getAgentModelConfig(agentId)).toBeDefined();
    }
  });

  it('keeps the flagship Claude default pointing at a real catalog model', () => {
    const claudeModels = getAgentStaticModels('claude');
    expect(CURRENT_FLAGSHIP_CLAUDE_MODEL_ID).toBe('claude-opus-5-5');
    expect(claudeModels.some((model) => model.id === CURRENT_FLAGSHIP_CLAUDE_MODEL_ID)).toBe(true);
  });

  it('adds an Ultracode boolean model option only to xhigh-capable Claude models', () => {
    const claudeModels = getAgentStaticModels('claude');
    const optionIdsFor = (modelId: string): string[] =>
      claudeModels.find((model) => model.id === modelId)?.modelOptions?.map((option) => option.id) ?? [];

    for (const modelId of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7']) {
      expect(optionIdsFor(modelId)).toContain('ultracode');
      const ultracode = claudeModels
        .find((model) => model.id === modelId)?.modelOptions?.find((option) => option.id === 'ultracode');
      expect(ultracode).toMatchObject({
        id: 'ultracode',
        name: 'Ultracode',
        type: 'boolean',
        currentValue: 'false',
      });
    }

    for (const modelId of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-5']) {
      expect(optionIdsFor(modelId)).not.toContain('ultracode');
    }
  });

  it('declares the [1m] extended-context variant only on 1M opt-in Claude models', () => {
    const claudeModels = getAgentStaticModels('claude');
    const variantFor = (modelId: string): string | undefined =>
      claudeModels.find((model) => model.id === modelId)?.extendedContextModelId;

    expect(variantFor('claude-sonnet-4-6')).toBe('claude-sonnet-4-6[1m]');
    expect(variantFor('claude-opus-4-6')).toBe('claude-opus-4-6[1m]');
    // Always-1M on the API: no opt-in toggle surfaced.
    expect(variantFor('claude-opus-5')).toBeUndefined();
    expect(variantFor('claude-opus-5-5')).toBeUndefined();
    expect(variantFor('claude-fable-5-1')).toBeUndefined();
    expect(variantFor('claude-sonnet-5-5')).toBeUndefined();
    expect(variantFor('claude-sonnet-5')).toBeUndefined();
    expect(variantFor('claude-fable-5')).toBeUndefined();
    expect(variantFor('claude-opus-4-8')).toBeUndefined();
    expect(variantFor('claude-opus-4-7')).toBeUndefined();
    expect(variantFor('claude-haiku-4-5')).toBeUndefined();
  });

  it('does not ship named static Codex models because Codex model truth is dynamic', () => {
    const codex = getAgentModelConfig('codex');
    const codexModels = getAgentStaticModels('codex');

    expect(codex.supportsSelection).toBe(true);
    expect(codex.dynamicProbe).toBe('auto');
    expect(codex.staticModels).toBeUndefined();
    expect(codex.allowedModes).toEqual(['default']);
    expect(codexModels).toEqual([{ id: 'default', name: 'default' }]);
  });

});

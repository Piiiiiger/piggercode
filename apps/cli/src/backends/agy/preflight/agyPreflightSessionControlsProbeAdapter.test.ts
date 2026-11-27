import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { requireCatalogEntry } from '@/backends/catalog';
import {
  probeAgentModelsBestEffort,
  resetAgentModelsProbeCacheForTests,
} from '@/capabilities/probes/agentModelsProbe';
import { createProbeTempDir, writeExecutableScript } from '@/capabilities/probes/agentModelsProbe.testkit';

async function writeFakeAgyBinary(dir: string, scriptBody: string): Promise<string> {
  const binPath = join(dir, 'agy');
  await writeExecutableScript(binPath, `#!/bin/sh\n${scriptBody}\n`);
  return binPath;
}

describe('Antigravity (agy) preflight model probing', () => {
  beforeEach(() => {
    resetAgentModelsProbeCacheForTests();
  });

  afterEach(() => {
    resetAgentModelsProbeCacheForTests();
  });

  it('registers a CLI models preflight probe adapter on the agy catalog entry', async () => {
    const entry = requireCatalogEntry('agy');
    expect(entry.getPreflightSessionControlsProbeAdapter).toBeTypeOf('function');
    const adapter = await entry.getPreflightSessionControlsProbeAdapter!();
    expect(adapter).toMatchObject({
      cliModelsCommandArgs: ['models'],
      connectedServiceAuth: {
        probeModels: 'not-required',
        probeModes: 'not-required',
        probeConfigOptions: 'not-required',
      },
    });
    expect(adapter?.transformCliModels).toBeTypeOf('function');
  });

  it('groups effort variants from `agy models` into base models with Thinking options and keeps standalone models ungrouped', async () => {
    const fixture = await createProbeTempDir('piggercode-agy-models-tsv');
    try {
      const binPath = await writeFakeAgyBinary(
        fixture.dir,
        `if [ "$1" = "models" ]; then
  printf 'Fetching available models...\\n' >&2
  printf 'gemini-4-neon-high\\tGemini 4 Neon (High)\\n'
  printf 'gemini-4-neon-xhigh\\tGemini 4 Neon (XHigh)\\n'
  printf 'gemini-4-neon-medium\\tGemini 4 Neon (Medium)\\n'
  printf 'gemini-4-neon-low\\tGemini 4 Neon (Low)\\n'
  printf 'gemini-pro-orchestrator\\tOrchestrator (Carbon)\\n'
  printf 'gemini-3.8-flash-high\\tGemini 3.8 Flash (High)\\n'
  printf 'gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)\\n'
  printf 'gpt-oss-120b-medium\\tGPT-OSS 120B (Medium)\\n'
  exit 0
fi
exit 1`,
      );

      const res = await probeAgentModelsBestEffort({
        agentId: 'agy',
        cwd: fixture.dir,
        timeoutMs: 5_000,
        processEnv: {
          ...process.env,
          PATH: fixture.dir,
          PIGGERCODE_AGY_PATH: binPath,
        },
      });

      expect(res.provider).toBe('agy');
      expect(res.source).toBe('dynamic');
      expect(res.availableModels).toEqual([
        { id: 'default', name: 'Default' },
        {
          id: 'gemini-4-neon',
          name: 'Gemini 4 Neon',
          description: 'gemini-4-neon',
          modelOptions: [
            {
              id: 'reasoning_effort',
              name: 'Thinking',
              type: 'select',
              currentValue: 'high',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
                { value: 'xhigh', name: 'XHigh' },
              ],
            },
          ],
        },
        {
          id: 'gemini-pro-orchestrator',
          name: 'Orchestrator (Carbon)',
          description: 'gemini-pro-orchestrator',
        },
        {
          id: 'gemini-3.8-flash',
          name: 'Gemini 3.8 Flash',
          description: 'gemini-3.8-flash',
          modelOptions: [
            {
              id: 'reasoning_effort',
              name: 'Thinking',
              type: 'select',
              currentValue: 'high',
              options: [
                { value: 'low', name: 'Low' },
                { value: 'high', name: 'High' },
              ],
            },
          ],
        },
        {
          id: 'gpt-oss-120b-medium',
          name: 'GPT-OSS 120B (Medium)',
          description: 'gpt-oss-120b-medium',
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('parses space-padded column output from `agy models` with descriptions and grouped Thinking options', async () => {
    const fixture = await createProbeTempDir('piggercode-agy-models-spaces');
    try {
      const binPath = await writeFakeAgyBinary(
        fixture.dir,
        `if [ "$1" = "models" ]; then
  printf 'gemini-4-carbon-medium         Gemini 4 Carbon (Medium)\\n'
  printf 'gemini-4-carbon-high           Gemini 4 Carbon (High)\\n'
  printf 'gemini-pro-orchestrator-neon   Orchestrator (Neon)\\n'
  exit 0
fi
exit 1`,
      );

      const res = await probeAgentModelsBestEffort({
        agentId: 'agy',
        cwd: fixture.dir,
        timeoutMs: 5_000,
        processEnv: {
          ...process.env,
          PATH: fixture.dir,
          PIGGERCODE_AGY_PATH: binPath,
        },
      });

      expect(res.source).toBe('dynamic');
      expect(res.availableModels).toEqual([
        { id: 'default', name: 'Default' },
        {
          id: 'gemini-4-carbon',
          name: 'Gemini 4 Carbon',
          description: 'gemini-4-carbon',
          modelOptions: [
            {
              id: 'reasoning_effort',
              name: 'Thinking',
              type: 'select',
              currentValue: 'medium',
              options: [
                { value: 'medium', name: 'Medium' },
                { value: 'high', name: 'High' },
              ],
            },
          ],
        },
        {
          id: 'gemini-pro-orchestrator-neon',
          name: 'Orchestrator (Neon)',
          description: 'gemini-pro-orchestrator-neon',
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('falls back to Default with refreshError when `agy models` fails', async () => {
    const fixture = await createProbeTempDir('piggercode-agy-models-fail');
    try {
      const binPath = await writeFakeAgyBinary(fixture.dir, 'exit 1');

      const res = await probeAgentModelsBestEffort({
        agentId: 'agy',
        cwd: fixture.dir,
        timeoutMs: 5_000,
        processEnv: {
          ...process.env,
          PATH: fixture.dir,
          PIGGERCODE_AGY_PATH: binPath,
        },
      });

      expect(res.provider).toBe('agy');
      expect(res.source).toBe('static');
      expect(res.refreshError).toBe(true);
      expect(res.availableModels).toEqual([{ id: 'default', name: 'Default' }]);
    } finally {
      await fixture.cleanup();
    }
  });
});

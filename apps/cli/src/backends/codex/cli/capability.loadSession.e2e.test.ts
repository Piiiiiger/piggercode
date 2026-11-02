import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { cliCapability as codexCliCapability } from './capability';
import { resolveCodexAcpSpawn } from '@/backends/codex/acp/resolveCommand';
import type { DetectCliEntry, DetectCliSnapshot } from '@/capabilities/snapshots/cliSnapshot';

type DetectArgs = Parameters<NonNullable<typeof codexCliCapability.detect>>[0];

function resolveBinaryOnPath(name: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { encoding: 'utf8' }).trim();
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : null;
  } catch {
    return null;
  }
}

function resolveCodexAcpIfAvailable(): string | null {
  try {
    const spawn = resolveCodexAcpSpawn();
    if (spawn.command.includes('/') || spawn.command.includes('\\')) {
      return existsSync(spawn.command) ? spawn.command : null;
    }
    return resolveBinaryOnPath(spawn.command);
  } catch {
    return null;
  }
}

function resolveProbeGate(): { enabled: boolean; reason: string } {
  const providersGate = process.env.PIGGERCODE_E2E_PROVIDERS ?? process.env.HAPPY_E2E_PROVIDERS;
  const codexGate = process.env.PIGGERCODE_E2E_PROVIDER_CODEX ?? process.env.HAPPY_E2E_PROVIDER_CODEX;
  if (providersGate !== '1' || codexGate !== '1') {
    return {
      enabled: false,
      reason: 'requires PIGGERCODE_E2E_PROVIDERS=1 and PIGGERCODE_E2E_PROVIDER_CODEX=1',
    };
  }

  const resolvedCodexPath = resolveBinaryOnPath('codex');
  if (!resolvedCodexPath) {
    return { enabled: false, reason: 'requires codex binary on PATH' };
  }

  const resolvedAcpPath = resolveCodexAcpIfAvailable();
  if (!resolvedAcpPath) {
    return { enabled: false, reason: 'requires codex-acp binary' };
  }

  return { enabled: true, reason: 'probe requirements satisfied' };
}

function makeUnavailableCliEntry(): DetectCliEntry {
  return { available: false, resolvedPath: undefined };
}

describe('cli.codex capability (ACP)', () => {
  const gate = resolveProbeGate();
  if (gate.enabled) {
  } else {
    it.skip(`detects session/load support when codex ACP is available [${gate.reason}]`, () => {});
  }
});

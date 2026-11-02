import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCliPathOverride } from './resolveCliPathOverride';

describe('resolveCliPathOverride', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalOverride = process.env.PIGGERCODE_CODEX_PATH;
  const tempDirs = new Set<string>();

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
    if (originalOverride === undefined) {
      delete process.env.PIGGERCODE_CODEX_PATH;
    } else {
      process.env.PIGGERCODE_CODEX_PATH = originalOverride;
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it('prefers the .cmd shim over an extensionless Windows override path', () => {
    if (!originalPlatformDescriptor) {
      throw new Error('Expected process.platform to be configurable for this test');
    }
    Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'win32' });

    const root = mkdtempSync(join(tmpdir(), 'happier-acp-override-win32-'));
    tempDirs.add(root);

    const extensionlessPath = join(root, 'codex');
    writeFileSync(extensionlessPath, '', 'utf8');
    const cmdShimPath = join(root, 'codex.cmd');
    writeFileSync(cmdShimPath, '@echo off\r\necho ok\r\n', 'utf8');

    process.env.PIGGERCODE_CODEX_PATH = extensionlessPath;
    process.env.PATHEXT = '.CMD;.EXE';

    expect(resolveCliPathOverride({ agentId: 'codex' })?.toLowerCase()).toBe(cmdShimPath.toLowerCase());
  });

  it('expands ~/ in Unix ACP path overrides', () => {
    if (process.platform === 'win32') {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), 'happier-acp-override-unix-'));
    tempDirs.add(root);
    const homeDir = join(root, 'home');
    const localBinDir = join(homeDir, '.local', 'bin');
    mkdirSync(localBinDir, { recursive: true });
    const cliPath = join(localBinDir, 'codex');
    writeFileSync(cliPath, '#!/bin/sh\necho ok\n', { mode: 0o755 });

    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;
    process.env.PIGGERCODE_CODEX_PATH = '~/.local/bin/codex';

    try {
      expect(resolveCliPathOverride({ agentId: 'codex' })).toBe(cliPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});

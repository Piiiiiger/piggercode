import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyProviderCliInstall, fetchProviderCliLatestVersion } from './update.js';

function writeExecutable(path: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 });
  return path;
}

describe.skipIf(process.platform === 'win32')('classifyProviderCliInstall', () => {
  let root: string;
  let home: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happier-provider-cli-update-'));
    home = join(root, 'home');
    mkdirSync(home, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('attributes a launcher linked into the vendor install root to the native updater', () => {
    const versioned = writeExecutable(join(home, '.local', 'share', 'claude', 'versions', '2.1.0'));
    const launcher = join(home, '.local', 'bin', 'claude');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    symlinkSync(versioned, launcher);

    expect(classifyProviderCliInstall({
      providerId: 'claude',
      command: launcher,
      source: 'system',
      platform: 'linux',
      env: { HOME: home },
    })).toEqual({
      installSource: 'native',
      updateSupported: true,
      updateCommand: `${launcher} update`,
      nativeUpdateArgs: ['update'],
    });
  });

  it('names the Homebrew cask that owns the executable', () => {
    const caskBin = writeExecutable(join(root, 'homebrew', 'Caskroom', 'claude-code', '2.1.0', 'claude'));
    const link = join(root, 'homebrew', 'bin', 'claude');
    mkdirSync(join(root, 'homebrew', 'bin'), { recursive: true });
    symlinkSync(caskBin, link);

    expect(classifyProviderCliInstall({
      providerId: 'claude',
      command: link,
      source: 'system',
      platform: 'darwin',
      env: { HOME: home },
    })).toMatchObject({
      installSource: 'brew',
      updateSupported: false,
      updateCommand: 'brew upgrade --cask claude-code',
    });
  });

});

describe('fetchProviderCliLatestVersion', () => {
  const DAY_MS = 24 * 60 * 60_000;
  const now = Date.parse('2026-09-26T08:00:00Z');

  it('reads the npm registry latest dist-tag for npm-published agents', async () => {
    const fetchJson = vi.fn(async (_url: string) => ({ version: '1.14.2' }));

    await expect(fetchProviderCliLatestVersion({ providerId: 'claude', installSource: 'native', deps: { fetchJson } }))
      .resolves.toEqual({ latestVersion: '1.14.2', heldVersion: null });
    expect(fetchJson.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest');
  });

  it('reads the GitHub latest release tag for release-binary agents', async () => {
    const fetchGitHubLatestRelease = vi.fn(async () => ({ tag_name: 'rust-v0.157.0' }));

    await expect(fetchProviderCliLatestVersion({
      providerId: 'codex',
      installSource: 'managed',
      deps: { fetchGitHubLatestRelease },
    })).resolves.toEqual({ latestVersion: '0.157.0', heldVersion: null });
    expect(fetchGitHubLatestRelease).toHaveBeenCalledWith(expect.objectContaining({ githubRepo: 'openai/codex' }));
  });

});

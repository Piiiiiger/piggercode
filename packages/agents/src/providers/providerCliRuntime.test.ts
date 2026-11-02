import { describe, expect, it } from 'vitest';

import { AGENT_IDS } from '../types.js';
import {
  getProviderCliBinaryNames,
  getProviderCliRuntimeSpec,
  PROVIDER_CLI_RUNTIME_SPECS,
  resolveProviderCliLatestVersionSource,
  resolveProviderCliNpmPackageName,
} from './providerCliRuntime.js';
import { getProviderCliManualInstallSummaryLines } from './providerCliInstallGuidance.js';


describe('PROVIDER_CLI_RUNTIME_SPECS', () => {

  it('declares managed binary sources for binary-backed CLIs', () => {
    expect(getProviderCliRuntimeSpec('codex')).toMatchObject({
      sourcePreferenceDefault: 'system-first',
      managedInstall: {
        kind: 'github_release_binary',
        binaryName: 'codex',
        githubRepo: 'openai/codex',
        assetNameByPlatform: {
          win32: {
            arm64: 'codex-package-aarch64-pc-windows-msvc.tar.gz',
            x64: 'codex-package-x86_64-pc-windows-msvc.tar.gz',
          },
        },
        archiveExtractionLimits: {
          maxFileBytes: 384 * 1024 * 1024,
          maxExpandedBytes: 512 * 1024 * 1024,
        },
      },
    });

    const managedInstall = getProviderCliRuntimeSpec('codex').managedInstall;
    expect(managedInstall?.kind).toBe('github_release_binary');
    if (managedInstall?.kind !== 'github_release_binary') return;
    const archiveExtractionLimits = managedInstall.archiveExtractionLimits;
    expect(archiveExtractionLimits).toBeDefined();
    if (!archiveExtractionLimits) return;

    // Digest-verified rust-v0.163.0 Windows x64 package: SHA-256
    // 901028b285614a9974f431f9d9f6534b3e5ed8d62eba4ba64f4762c00f040522.
    expect(archiveExtractionLimits.maxFileBytes).toBeGreaterThanOrEqual(341_270_320);
    expect(archiveExtractionLimits.maxExpandedBytes).toBeGreaterThanOrEqual(465_689_987);
  });

  it('uses directly spawnable Windows PowerShell executables for every vendor recipe', () => {
    for (const providerId of AGENT_IDS) {
      for (const command of getProviderCliRuntimeSpec(providerId).manualInstallRecipes?.win32 ?? []) {
        if (command.args.includes('-Command')) {
          expect(command.cmd, providerId).toBe('powershell.exe');
        }
      }
    }
  });

  it('covers every built-in provider', () => {
    expect(Object.keys(PROVIDER_CLI_RUNTIME_SPECS).sort()).toEqual([...AGENT_IDS].sort());
  });

});

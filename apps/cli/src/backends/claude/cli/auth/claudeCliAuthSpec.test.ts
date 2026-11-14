import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { writeExecutableShim } from '@/testkit/fs/executableShim';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';

import { claudeCliAuthSpec } from './claudeCliAuthSpec';

const envKeys = [
  'HOME',
  'USERPROFILE',
  'CLAUDE_CONFIG_DIR',
  'PIGGERCODE_CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
] as const;

describe('claudeCliAuthSpec', () => {
  const tempDirs: string[] = [];
  let envScope = createEnvKeyScope(envKeys);

  afterEach(async () => {
    envScope.restore();
    envScope = createEnvKeyScope(envKeys);
    await Promise.all(tempDirs.splice(0).map((dir) => removeTempDir(dir).catch(() => undefined)));
  });

  it('reads credentials from CLAUDE_CONFIG_DIR when an explicit override is set', async () => {
    const dir = await createTempDir('happier-claude-auth-spec-');
    tempDirs.push(dir);

    const overriddenConfigDir = join(dir, 'custom-claude-config');
    await mkdir(overriddenConfigDir, { recursive: true });
    await writeFile(
      join(overriddenConfigDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'claude-token',
          refreshToken: 'claude-refresh',
          expiresAt: Date.now() + 60_000,
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        },
        oauthAccount: {
          emailAddress: 'claude-override@example.test',
        },
      }),
      'utf8',
    );

    envScope.patch({
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: overriddenConfigDir,
      PIGGERCODE_CLAUDE_CONFIG_DIR: undefined,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    const detectAuthStatus = claudeCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) {
      throw new Error('claudeCliAuthSpec.detectAuthStatus must be defined for this test');
    }

    await expect(detectAuthStatus({ resolvedPath: '/tmp/fake-claude' })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'credentials_file',
      source: 'file',
      accountLabel: 'claude-override@example.test',
    });
  });

  it('reads credentials from the current .claude.json layout', async () => {
    const dir = await createTempDir('happier-claude-auth-spec-');
    tempDirs.push(dir);

    const claudeConfigDir = join(dir, '.claude');
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(
      join(claudeConfigDir, '.claude.json'),
      JSON.stringify({
        oauthAccount: {
          emailAddress: 'claude-json@example.test',
        },
      }),
      'utf8',
    );
    await writeFile(
      join(claudeConfigDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'claude-token',
          refreshToken: 'claude-refresh',
          expiresAt: Date.now() + 60_000,
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        },
      }),
      'utf8',
    );

    envScope.patch({
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      PIGGERCODE_CLAUDE_CONFIG_DIR: undefined,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    const detectAuthStatus = claudeCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) {
      throw new Error('claudeCliAuthSpec.detectAuthStatus must be defined for this test');
    }

    await expect(detectAuthStatus({ resolvedPath: '/tmp/fake-claude' })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'credentials_file',
      source: 'file',
      accountLabel: 'claude-json@example.test',
    });
  });

  it('prefers a valid current credentials file over an expired legacy credentials file', async () => {
    const dir = await createTempDir('happier-claude-auth-spec-');
    tempDirs.push(dir);

    const claudeConfigDir = join(dir, '.claude');
    await mkdir(claudeConfigDir, { recursive: true });
    await writeFile(
      join(claudeConfigDir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'expired-legacy-token',
          refreshToken: 'expired-legacy-refresh',
          expiresAt: Date.parse('2000-01-01T00:00:00.000Z'),
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        },
      }),
      'utf8',
    );
    await writeFile(
      join(claudeConfigDir, '.claude.json'),
      JSON.stringify({
        oauthAccount: {
          emailAddress: 'claude-current@example.test',
        },
      }),
      'utf8',
    );
    await writeFile(
      join(claudeConfigDir, 'credentials.json'),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'valid-current-token',
          refreshToken: 'valid-current-refresh',
          expiresAt: Date.now() + 60_000,
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        },
      }),
      'utf8',
    );

    envScope.patch({
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      PIGGERCODE_CLAUDE_CONFIG_DIR: undefined,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    const detectAuthStatus = claudeCliAuthSpec.detectAuthStatus;
    expect(detectAuthStatus).toBeTypeOf('function');
    if (!detectAuthStatus) {
      throw new Error('claudeCliAuthSpec.detectAuthStatus must be defined for this test');
    }

    await expect(detectAuthStatus({ resolvedPath: '/tmp/fake-claude' })).resolves.toMatchObject({
      state: 'logged_in',
      method: 'credentials_file',
      source: 'file',
      accountLabel: 'claude-current@example.test',
    });
  });

  /** A home with Claude Code's credentials file (or none) and a stand-in `claude` that answers `auth status --json`. */
  async function claudeHome(params: Readonly<{
    oauth?: Record<string, unknown>;
    statusReport?: Readonly<{ stdout: string; exitCode: number }>;
  }>): Promise<Readonly<{ claudePath: string }>> {
    const dir = await createTempDir('happier-claude-auth-spec-');
    tempDirs.push(dir);
    const configDir = join(dir, '.claude');
    await mkdir(configDir, { recursive: true });
    if (params.oauth) {
      await writeFile(join(configDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: params.oauth }), 'utf8');
    }
    const report = params.statusReport ?? { stdout: '', exitCode: 1 };
    const claudePath = await writeExecutableShim({
      dir,
      fileName: process.platform === 'win32' ? 'claude.cmd' : 'claude',
      contents: process.platform === 'win32'
        ? `@echo off\r\necho ${report.stdout}\r\nexit /b ${report.exitCode}\r\n`
        : `#!/bin/sh\ncat <<'JSON'\n${report.stdout}\nJSON\nexit ${report.exitCode}\n`,
    });
    envScope.patch({
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: configDir,
      PIGGERCODE_CLAUDE_CONFIG_DIR: undefined,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });
    return { claudePath };
  }

  const DAY_MS = 24 * 60 * 60 * 1000;

  it('keeps the login until its refresh token ends, though the access token (hours) has run out', async () => {
    const loginEndsAt = Date.now() + 20 * DAY_MS;
    const { claudePath } = await claudeHome({
      oauth: {
        accessToken: 'claude-token',
        refreshToken: 'claude-refresh',
        expiresAt: Date.now() - 60 * 60 * 1000,
        refreshTokenExpiresAt: loginEndsAt,
        scopes: ['user:inference'],
      },
    });

    await expect(claudeCliAuthSpec.detectAuthStatus!({ resolvedPath: claudePath })).resolves.toMatchObject({
      state: 'logged_in',
      source: 'file',
      expiresAt: loginEndsAt,
    });
  });

  it('reports a login whose refresh token has ended as expired', async () => {
    const { claudePath } = await claudeHome({
      oauth: {
        accessToken: 'claude-token',
        refreshToken: 'claude-refresh',
        expiresAt: Date.now() + 60 * 60 * 1000,
        refreshTokenExpiresAt: Date.now() - 60_000,
        scopes: ['user:inference'],
      },
    });

    await expect(claudeCliAuthSpec.detectAuthStatus!({ resolvedPath: claudePath })).resolves.toMatchObject({
      state: 'logged_out',
      reason: 'expired',
    });
  });

  it('asks Claude Code when there is no credentials file (a login kept in the macOS Keychain)', async () => {
    const { claudePath } = await claudeHome({
      statusReport: {
        stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"keychain@example.test","loginExpiresAt":"2026-12-13T06:37:00.149Z"}',
        exitCode: 0,
      },
    });

    await expect(claudeCliAuthSpec.detectAuthStatus!({ resolvedPath: claudePath })).resolves.toMatchObject({
      state: 'logged_in',
      source: 'command',
      accountLabel: 'keychain@example.test',
      expiresAt: Date.parse('2026-12-13T06:37:00.149Z'),
    });
  });

  it('reports logged out when Claude Code says so', async () => {
    const { claudePath } = await claudeHome({
      statusReport: { stdout: '{"loggedIn":false,"authMethod":"none","loginExpiresAt":null}', exitCode: 1 },
    });

    await expect(claudeCliAuthSpec.detectAuthStatus!({ resolvedPath: claudePath })).resolves.toMatchObject({
      state: 'logged_out',
      reason: 'missing_credentials',
      source: 'command',
    });
  });

  it("asks Claude Code about the profile PiggerCode's sessions use (PIGGERCODE_CLAUDE_CONFIG_DIR)", async () => {
    const dir = await createTempDir('happier-claude-auth-spec-');
    tempDirs.push(dir);
    const profileDir = join(dir, 'piggercode-claude');
    await mkdir(profileDir, { recursive: true });
    // The stand-in is logged in to that profile only.
    const loggedIn = '{"loggedIn":true,"email":"profile@example.test","loginExpiresAt":null}';
    const loggedOut = '{"loggedIn":false,"loginExpiresAt":null}';
    const claudePath = await writeExecutableShim({
      dir,
      fileName: process.platform === 'win32' ? 'claude.cmd' : 'claude',
      contents: process.platform === 'win32'
        ? `@echo off\r\nif "%CLAUDE_CONFIG_DIR%"=="${profileDir}" (echo ${loggedIn}) else (echo ${loggedOut})\r\n`
        : `#!/bin/sh\nif [ "$CLAUDE_CONFIG_DIR" = '${profileDir}' ]; then echo '${loggedIn}'; else echo '${loggedOut}'; fi\n`,
    });
    envScope.patch({
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: undefined,
      PIGGERCODE_CLAUDE_CONFIG_DIR: profileDir,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    await expect(claudeCliAuthSpec.detectAuthStatus!({ resolvedPath: claudePath })).resolves.toMatchObject({
      state: 'logged_in',
      source: 'command',
      accountLabel: 'profile@example.test',
    });
  });
});

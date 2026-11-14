import { basename, join } from 'node:path';

import { getAgentAuthProbeConfig } from '@piggercode/agents';
import { createCatalogCliAuthSpec } from '@/capabilities/cliAuth/createCatalogCliAuthSpec';
import {
  CLI_AUTH_COMMAND_PROBE_TIMEOUT_MS,
  readJsonFileSafe,
  readStringField,
  runCliCommandBestEffort,
} from '@/capabilities/cliAuth/shared';
import { parseClaudeCodeCredentialFile } from '@/backends/claude/connectedServices/nativeAuth/claudeCodeCredentialFile';
import type { CliAuthSpec, CliAuthStatusDraft } from '@/backends/types';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';
import { resolveClaudeConfigDirEnvOverlay } from '@/backends/claude/utils/resolveClaudeConfigDirEnvOverlay';

function readClaudeOauthAccountLabel(record: Record<string, unknown>): string | null {
  const oauthAccount =
    record.oauthAccount && typeof record.oauthAccount === 'object' && !Array.isArray(record.oauthAccount)
      ? record.oauthAccount as Record<string, unknown>
      : null;

  return oauthAccount
    ? readStringField(oauthAccount, 'emailAddress')
      ?? readStringField(oauthAccount, 'email')
      ?? readStringField(oauthAccount, 'displayName')
      ?? readStringField(oauthAccount, 'name')
    : null;
}

function readClaudeAccountLabel(configDir: string, fallbackRecord?: Record<string, unknown>): string | undefined {
  const rootConfig = readJsonFileSafe(join(configDir, '.claude.json'));
  const rootRecord =
    rootConfig && typeof rootConfig === 'object' && !Array.isArray(rootConfig)
      ? rootConfig as Record<string, unknown>
      : null;
  const accountLabel =
    (rootRecord ? readClaudeOauthAccountLabel(rootRecord) : null)
    ?? (fallbackRecord ? readClaudeOauthAccountLabel(fallbackRecord) : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'email') : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'accountEmail') : null)
    ?? (fallbackRecord ? readStringField(fallbackRecord, 'userEmail') : null);

  return accountLabel ?? undefined;
}

function readClaudeCredentialsStatus(env: NodeJS.ProcessEnv): CliAuthStatusDraft {
  const configDir = resolveConfiguredClaudeConfigDir({ env });
  const credentialFiles = Array.from(new Set([
    ...(getAgentAuthProbeConfig('claude').credentialPaths?.map((credentialPath) => basename(credentialPath)) ?? []),
    '.credentials.json',
    'credentials.json',
  ]));
  let expiredCredentialsStatus: CliAuthStatusDraft | null = null;

  for (const credentialFile of credentialFiles) {
    const parsed = readJsonFileSafe(join(configDir, credentialFile));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    const record = parsed as Record<string, unknown>;
    const credential = parseClaudeCodeCredentialFile(record);
    if (credential.status !== 'ok' || !credential.hasAccessToken) {
      continue;
    }

    // The login lasts as long as its refresh token; Claude Code renews the access token (hours) with it.
    const loginEndsAt = credential.refreshTokenExpiresAt ?? credential.expiresAt;
    if (loginEndsAt !== null && loginEndsAt <= Date.now()) {
      expiredCredentialsStatus = { state: 'logged_out', reason: 'expired', source: 'file', method: 'credentials_file' };
      continue;
    }

    return {
      state: 'logged_in',
      method: 'credentials_file',
      source: 'file',
      expiresAt: credential.refreshTokenExpiresAt,
      ...(() => {
        const accountLabel = readClaudeAccountLabel(configDir, record);
        return accountLabel ? { accountLabel } : {};
      })(),
    };
  }

  if (expiredCredentialsStatus) {
    return expiredCredentialsStatus;
  }

  return { state: 'logged_out', reason: 'missing_credentials' };
}

/** What `claude auth status --json` reports (Claude Code 2.1): logged in or not, the account, when the login ends. */
function readClaudeAuthStatusReport(stdout: string): CliAuthStatusDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const report = parsed as Record<string, unknown>;
  if (typeof report.loggedIn !== 'boolean') return null;
  if (!report.loggedIn) {
    return { state: 'logged_out', reason: 'missing_credentials', source: 'command' };
  }
  const endsAt = typeof report.loginExpiresAt === 'string' ? Date.parse(report.loginExpiresAt) : Number.NaN;
  const accountLabel = readStringField(report, 'email');
  return {
    state: 'logged_in',
    method: 'oauth_cli',
    source: 'command',
    expiresAt: Number.isFinite(endsAt) ? endsAt : null,
    ...(accountLabel ? { accountLabel } : {}),
  };
}

export const claudeCliAuthSpec: CliAuthSpec = createCatalogCliAuthSpec('claude', {
  detectAuthStatus: async ({ resolvedPath }) => {
    const anthropicApiKey = typeof process.env.ANTHROPIC_API_KEY === 'string' ? process.env.ANTHROPIC_API_KEY.trim() : '';
    if (anthropicApiKey) {
      return {
        state: 'logged_in',
        method: 'api_key_env',
        source: 'env',
        reason: null,
      };
    }

    const anthropicAuthToken = typeof process.env.ANTHROPIC_AUTH_TOKEN === 'string' ? process.env.ANTHROPIC_AUTH_TOKEN.trim() : '';
    if (anthropicAuthToken) {
      return {
        state: 'logged_in',
        method: 'auth_token_env',
        source: 'env',
        reason: null,
      };
    }

    const fileStatus = readClaudeCredentialsStatus(process.env);
    if (fileStatus.reason !== 'missing_credentials') return fileStatus;
    // No credentials file: Claude Code keeps the login in the macOS Keychain, or there is none. Claude Code says
    // which (reading its file is instant; starting Claude Code takes a second or two).
    const command = await runCliCommandBestEffort({
      resolvedPath,
      args: ['auth', 'status', '--json'],
      timeoutMs: CLI_AUTH_COMMAND_PROBE_TIMEOUT_MS,
      // The Claude profile PiggerCode's sessions use (PIGGERCODE_CLAUDE_CONFIG_DIR), as a session launch sets it.
      env: { ...process.env, ...resolveClaudeConfigDirEnvOverlay(process.env) },
    });
    const reported = readClaudeAuthStatusReport(command.stdout);
    if (reported) return reported;
    // A Claude Code without `auth status` answers with an error; one that did not answer at all is not known.
    return command.exitCode === null
      ? { state: 'unknown', reason: 'probe_failed', source: 'command' }
      : fileStatus;
  },
});

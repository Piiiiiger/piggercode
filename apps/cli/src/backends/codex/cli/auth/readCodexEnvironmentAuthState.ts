import { join, resolve } from 'node:path';

import { decodeJwtEmail, readJsonFileSafe } from '@/capabilities/cliAuth/shared';
import { extractAccountId } from '../../cloud/oauthExchange';
import { resolveConfiguredCodexHome } from '../../utils/resolveConfiguredCodexHome';

export type CodexEnvironmentAuthMethod = 'api_key_env' | 'credentials_file';

export type CodexEnvironmentAuthState = Readonly<{
    method: CodexEnvironmentAuthMethod | null;
    accountLabel: string | null;
}>;

export type CodexEnvironmentAuthTokens = Readonly<{
    idToken: string | null;
    accessToken: string | null;
    accountId: string | null;
    accountLabel: string | null;
}>;

type CodexAuthRecordTokens = Readonly<{
    idToken: string | null;
    accessToken: string | null;
    accountId: string | null;
}>;

function parseCodexAuthRecordTokens(parsed: unknown): CodexAuthRecordTokens {
    const empty = { idToken: null, accessToken: null, accountId: null };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const tokens = (parsed as Record<string, unknown>).tokens;
    if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return empty;
    const record = tokens as Record<string, unknown>;
    const stringField = (key: string) => typeof record[key] === 'string' && record[key].trim()
        ? record[key].trim() : null;
    const idToken = stringField('id_token');
    const accessToken = stringField('access_token');
    let accountId = stringField('account_id');
    // Codex TokenData.account_id is optional; derive identity from this same native record.
    for (const token of [idToken, accessToken]) {
        if (accountId || !token) continue;
        try {
            accountId = extractAccountId(token).trim() || null;
        } catch {
            // A malformed claim leaves the account id unknown.
        }
    }
    return { idToken, accessToken, accountId };
}

export function readCodexApiKey(env: NodeJS.ProcessEnv): string {
    const openAiApiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
    if (openAiApiKey) return openAiApiKey;

    const codexApiKey = typeof env.CODEX_API_KEY === 'string' ? env.CODEX_API_KEY.trim() : '';
    return codexApiKey;
}

export function resolveCodexApiKeyAuthMethodId(
    env: NodeJS.ProcessEnv,
): 'openai-api-key' | 'codex-api-key' | undefined {
    const openAiApiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
    if (openAiApiKey) return 'openai-api-key';

    const codexApiKey = typeof env.CODEX_API_KEY === 'string' ? env.CODEX_API_KEY.trim() : '';
    if (codexApiKey) return 'codex-api-key';

    return undefined;
}

function readJwtExpMs(token: string | null): number | null {
    if (typeof token !== 'string' || !token.trim()) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    try {
        const payload = JSON.parse(
            Buffer.from((parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        ) as Record<string, unknown>;
        const exp = payload.exp;
        return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
    } catch {
        return null;
    }
}

function hasUsableJwtLifetime(token: string | null): boolean {
    if (typeof token !== 'string' || !token.trim()) return false;
    const expMs = readJwtExpMs(token);
    return expMs === null || expMs > Date.now();
}

function resolveCodexAuthHomeDir(env: NodeJS.ProcessEnv): string {
    return resolve(resolveConfiguredCodexHome(env));
}

export function readCodexEnvironmentAuthTokens(env: NodeJS.ProcessEnv = process.env): CodexEnvironmentAuthTokens {
    const parsed = readJsonFileSafe(join(resolveCodexAuthHomeDir(env), 'auth.json'));
    const { idToken, accessToken, accountId } = parseCodexAuthRecordTokens(parsed);
    const hasUsableToken = hasUsableJwtLifetime(idToken) || hasUsableJwtLifetime(accessToken);

    return {
        idToken: hasUsableToken ? idToken : null,
        accessToken: hasUsableToken ? accessToken : null,
        accountId: hasUsableToken ? accountId : null,
        accountLabel: hasUsableToken ? (decodeJwtEmail(idToken) ?? decodeJwtEmail(accessToken)) : null,
    };
}

export function readCodexEnvironmentAuthState(env: NodeJS.ProcessEnv = process.env): CodexEnvironmentAuthState {
    const authFileTokens = readCodexEnvironmentAuthTokens(env);
    const apiKey = readCodexApiKey(env);

    if (apiKey) {
        return { method: 'api_key_env', accountLabel: null };
    }

    if (authFileTokens.idToken || authFileTokens.accessToken) {
        return {
            method: 'credentials_file',
            accountLabel: authFileTokens.accountLabel,
        };
    }

    return { method: null, accountLabel: null };
}

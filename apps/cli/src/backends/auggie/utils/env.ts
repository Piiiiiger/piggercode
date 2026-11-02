import { PIGGERCODE_AUGGIE_ALLOW_INDEXING_ENV } from '@/backends/auggie/constants';

export function readAuggieAllowIndexingFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = typeof env[PIGGERCODE_AUGGIE_ALLOW_INDEXING_ENV] === 'string'
    ? String(env[PIGGERCODE_AUGGIE_ALLOW_INDEXING_ENV]).trim().toLowerCase()
    : '';
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

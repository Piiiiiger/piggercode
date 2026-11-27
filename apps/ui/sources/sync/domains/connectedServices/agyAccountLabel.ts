import { AGY_DEFAULT_ACCOUNT_ID } from '@piggercode/protocol';

import { t } from '@/text';

/** How a Gemini (agy) login is named in the app: its email when known, else the real home's login or its folder name. */
export function agyAccountLabel(account: Readonly<{ accountId: string; email?: string | null }>): string {
    if (account.email) return account.email;
    return account.accountId === AGY_DEFAULT_ACCOUNT_ID
        ? t('connectedServices.agyUsage.unknownAccount')
        : t('connectedServices.agyUsage.namedAccount', { name: account.accountId });
}

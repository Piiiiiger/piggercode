import type { ConnectedServiceId } from '@piggercode/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { assertConnectedServiceOperationSupported } from '@/sync/api/account/connectedServiceOperationSupport';
import type { ConnectedServiceOauthAdapter } from '@/sync/domains/connectedServices/oauth/connectedServiceOauthAdapters';
import { t } from '@/text';
import { parseOauthCallbackUrl } from '@/utils/auth/oauthCore';

import { runConnectedServiceCredentialStoredEffects } from '../runConnectedServiceCredentialStoredEffects';
import { storeConnectedServiceCredentialWithIdentityConfirmation } from '../storeConnectedServiceCredentialWithIdentityConfirmation';

/** One sign-in attempt: what the browser was sent with, so its answer can be checked and exchanged. */
export type ConnectedServiceOauthAttempt = Readonly<{
  redirectUri: string;
  state: string;
  verifier: string;
}>;

/**
 * Finish a sign-in from the address the browser came back to, whether pasted or caught on this computer: check
 * that it answers this attempt, exchange the code through the relay and store the account. Resolves to whether
 * the account was stored (the identity check can be declined).
 */
export async function completeConnectedServiceOauthCallback(params: Readonly<{
  serviceId: ConnectedServiceId;
  profileId: string;
  adapter: ConnectedServiceOauthAdapter;
  credentials: AuthCredentials;
  attempt: ConnectedServiceOauthAttempt;
  callbackUrl: string;
  missingStateError: string;
  /** Called just before the one-use code goes to the provider: a failure after it needs a new attempt. */
  onExchangeStart?: () => void;
}>): Promise<boolean> {
  await assertConnectedServiceOperationSupported(params.serviceId);
  const parsed = parseOauthCallbackUrl({
    url: params.callbackUrl,
    redirectUri: params.attempt.redirectUri,
    allowRawAuthorizationCode: params.adapter.allowRawAuthorizationCode,
  });
  if (parsed.error) throw new Error(`OAuth error: ${parsed.error}`);
  const code = parsed.code ?? '';
  // Raw manual codes return no state. The opted-in provider verifies this
  // exact attempt's PKCE; structured callback responses still return state.
  const returnedState = parsed.rawAuthorizationCode ? params.attempt.state : parsed.state ?? '';
  if (!code) throw new Error('Missing code');
  if (!returnedState) throw new Error(params.missingStateError);
  if (returnedState !== params.attempt.state) throw new Error(t('connectedServices.oauthPaste.errors.stateMismatch'));

  params.onExchangeStart?.();
  const record = await params.adapter.exchangeAuthorizationCodeForRecord({
    credentials: params.credentials,
    profileId: params.profileId,
    code,
    verifier: params.attempt.verifier,
    redirectUri: params.attempt.redirectUri,
    state: returnedState,
    now: Date.now(),
  });
  return await storeConnectedServiceCredentialWithIdentityConfirmation(
    params.credentials,
    { serviceId: params.serviceId, profileId: params.profileId, record },
    { onStored: runConnectedServiceCredentialStoredEffects },
  );
}

import { describe, expect, it } from 'vitest';

import { classifyPrimarySessionRuntimeIssue } from './classifyPrimarySessionRuntimeIssue';
import { requireProviderCliCommand } from '@/runtime/managedTools/requireProviderCliCommand';
import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';

describe('classifyPrimarySessionRuntimeIssue', () => {

  it('does not turn ambiguous wall-clock usage-limit retry wording into a daemon-local reset time', () => {
    const occurredAt = new Date(2026, 4, 18, 13, 2, 41, 0).getTime();

    expect(classifyPrimarySessionRuntimeIssue({
      provider: 'codex',
      cause: 'status_error',
      error: new Error("You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 1:48 PM."),
      occurredAt,
    })).toMatchObject({
      source: 'usage_limit',
      usageLimit: {
        v: 1,
        resetAtMs: null,
        retryAfterMs: null,
        quotaScope: 'unknown',
        recoverability: 'wait',
      },
    });
  });

  it('keeps capacity runtime auth classifications distinct from usage limits', () => {
    const error = new Error('provider overloaded') as Error & {
      runtimeAuthClassification: {
        kind: 'capacity';
        serviceId: string;
        profileId: string | null;
        groupId: string | null;
        retryAfterMs?: number | null;
        limitCategory?: 'capacity';
        providerLimitId?: string | null;
        source: string;
      };
    };
    error.runtimeAuthClassification = {
      kind: 'capacity',
      serviceId: 'openai-codex',
      profileId: 'primary',
      groupId: 'codex-main',
      retryAfterMs: 45_000,
      limitCategory: 'capacity',
      providerLimitId: 'server_overloaded',
      source: 'structured_provider_error',
    };

    expect(classifyPrimarySessionRuntimeIssue({
      provider: 'codex',
      cause: 'status_error',
      error,
      occurredAt: 1_000,
    })).toMatchObject({
      source: 'provider_status_error',
      usageLimit: {
        v: 1,
        retryAfterMs: 45_000,
        limitCategory: 'capacity',
        providerLimitId: 'server_overloaded',
        connectedService: {
          serviceId: 'openai-codex',
          profileId: 'primary',
          groupId: 'codex-main',
        },
      },
    });
  });

  it('does not classify provider temporary throttles as usage-limit exhaustion', () => {
    expect(classifyPrimarySessionRuntimeIssue({
      provider: 'codex',
      cause: 'status_error',
      error: new Error('API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited'),
      occurredAt: 1_000,
    })).toMatchObject({
      source: 'provider_status_error',
      code: 'provider_temporary_throttle',
      sanitizedPreview: 'Provider is temporarily limiting requests',
      temporaryThrottle: {
        v: 1,
        retryAfterMs: null,
        recoverability: 'retry',
      },
    });
    expect(classifyPrimarySessionRuntimeIssue({
      provider: 'codex',
      cause: 'status_error',
      error: new Error('API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited'),
      occurredAt: 1_000,
    }).usageLimit).toBeUndefined();
  });

  it('reads retry-after-ms temporary throttle headers as milliseconds', () => {
    const error = Object.assign(
      new Error('API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited'),
      {
        headers: {
          'retry-after-ms': '2500',
        },
      },
    );

    expect(classifyPrimarySessionRuntimeIssue({
      provider: 'codex',
      cause: 'status_error',
      error,
      occurredAt: 1_000,
    })).toMatchObject({
      code: 'provider_temporary_throttle',
      temporaryThrottle: {
        retryAfterMs: 2_500,
      },
    });
  });

  it('keeps auth, plan, and validation runtime auth classifications structured', () => {
    for (const [kind, expectedSource, inputCategory, expectedCategory] of [
      ['auth_expired', 'auth_error', 'auth_invalid', 'auth_invalid'],
      ['plan', 'provider_status_error', 'plan_invalid', 'plan_invalid'],
      ['validation', 'provider_status_error', 'validation_failed', 'validation_failed'],
    ] as const) {
      const error = new Error(kind) as Error & {
        runtimeAuthClassification: {
          kind: typeof kind;
          serviceId: string;
          profileId: string | null;
          groupId: string | null;
          resetsAtMs?: number | null;
          limitCategory?: typeof inputCategory;
          source: string;
        };
      };
      error.runtimeAuthClassification = {
        kind,
        serviceId: 'openai-codex',
        profileId: 'primary',
        groupId: 'codex-main',
        resetsAtMs: 9_000,
        limitCategory: inputCategory,
        source: 'structured_provider_error',
      };

      expect(classifyPrimarySessionRuntimeIssue({
        provider: 'codex',
        cause: 'status_error',
        error,
        occurredAt: 1_000,
      })).toMatchObject({
        source: expectedSource,
        usageLimit: {
          v: 1,
          resetAtMs: 9_000,
          limitCategory: expectedCategory,
          connectedService: {
            serviceId: 'openai-codex',
            profileId: 'primary',
            groupId: 'codex-main',
          },
        },
      });
    }
  });

  it('keeps incidental 401 identifiers out of auth issue classification', () => {
    expect(classifyPrimarySessionRuntimeIssue({
      cause: 'status_error',
      error: new Error('[provider-acp] WARN: failed to decode gen_metadata 401: cant skip wire type 6'),
      occurredAt: 1_000,
    })).toMatchObject({
      source: 'provider_status_error',
      code: 'provider_status_error',
    });
  });

  it('classifies contextual HTTP 401 failures as auth issues', () => {
    expect(classifyPrimarySessionRuntimeIssue({
      cause: 'status_error',
      error: new Error('Request failed with status code 401'),
      occurredAt: 1_000,
    })).toMatchObject({
      source: 'auth_error',
      code: 'auth_error',
    });
  });
});

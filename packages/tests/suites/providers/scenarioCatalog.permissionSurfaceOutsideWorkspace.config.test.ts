import { describe, expect, it } from 'vitest';

import { scenarioCatalog } from '../../src/testkit/providers/scenarios/scenarioCatalog';
import type { ProviderScenario, ProviderUnderTest } from '../../src/testkit/providers/types';

function providerStub(params: {
  id: string;
  permissions?: ProviderUnderTest['permissions'];
}): ProviderUnderTest {
  return {
    id: params.id,
    enableEnvVar: 'PIGGERCODE_E2E_PROVIDER_EXAMPLE',
    protocol: 'acp',
    traceProvider: params.id,
    permissions: params.permissions,
    scenarioRegistry: { v: 1, tiers: { smoke: [], extended: [] } },
    cli: { subcommand: params.id },
  };
}

function buildPermissionSurfaceScenario(params: {
  id: string;
  permissions?: ProviderUnderTest['permissions'];
}) {
  return scenarioCatalog.permission_surface_outside_workspace(
    providerStub({
      id: params.id,
      permissions: params.permissions,
    }),
  );
}

function resolveScenarioMessageMeta(scenario: ProviderScenario): Record<string, unknown> {
  const messageMeta = scenario.messageMeta;
  return typeof messageMeta === 'function' ? messageMeta({ workspaceDir: '/tmp' }) : (messageMeta ?? {});
}

describe('scenarioCatalog (permission_surface_outside_workspace config)', () => {

  it('respects permissions.acp.expectToolPermissionPrompts for codex patch scenarios', () => {
    const provider = providerStub({
      id: 'codex',
      permissions: {
        v: 1,
        acp: {
          expectToolPermissionPrompts: false,
        },
      },
    });

    const approveScenario = scenarioCatalog.permission_surface_patch_apply(provider);
    const denyScenario = scenarioCatalog.permission_abort_patch_apply(provider);

    expect((approveScenario.requiredTraceSubstrings ?? []).some((k) => k.includes('permission-request'))).toBe(false);
    const denyMeta = resolveScenarioMessageMeta(denyScenario);
    expect(denyMeta.permissionMode).toBe('read-only');
  });

  it('allows codex deny outside-workspace scenarios without task_complete gating', () => {
    const scenario = scenarioCatalog.permission_deny_outside_workspace(
      providerStub({
        id: 'codex',
        permissions: {
          v: 1,
          acp: {
            toolPermissionPromptsByMode: {
              default: false,
              'safe-yolo': false,
              'read-only': false,
              yolo: false,
              plan: false,
            },
            outsideWorkspaceRequireTaskCompleteByMode: {
              default: false,
              'safe-yolo': false,
              'read-only': false,
              yolo: false,
              plan: false,
            },
          },
        },
      }),
    );

    expect((scenario.requiredTraceSubstrings ?? []).includes('task_complete')).toBe(false);
    const flat = (scenario.requiredAnyFixtureKeys ?? []).flat();
    expect(flat.some((key) => key.includes('/permission-request/'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { resolveSessionHandoffEligibility } from './resolveSessionHandoffEligibility';

describe('resolveSessionHandoffEligibility', () => {
  it('allows an eligible persisted Claude session', () => {
    expect(
      resolveSessionHandoffEligibility({
        metadata: {
          flavor: 'claude',
          machineId: 'machine_source',
          claudeSessionId: 'sess_1',
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'claude',
      storageMode: 'persisted',
      sourceMachineId: 'machine_source',
      vendorHandoffId: 'sess_1',
    });
  });

  it('rejects sessions whose provider cannot be inferred', () => {
    expect(resolveSessionHandoffEligibility({ metadata: { machineId: 'm1' } })).toEqual({
      eligible: false,
      reasonCode: 'agent_unknown',
    });
  });

  it('rejects sessions missing a source machine id', () => {
    expect(
      resolveSessionHandoffEligibility({
        metadata: { flavor: 'claude', claudeSessionId: 'sess_1' },
      }),
    ).toEqual({
      eligible: false,
      reasonCode: 'source_machine_missing',
    });
  });

  it('allows a codex app-server session without requiring account settings', () => {
    expect(
      resolveSessionHandoffEligibility({
        metadata: {
          flavor: 'codex',
          machineId: 'machine_source',
          codexSessionId: 'codex_1',
          codexBackendMode: 'appServer',
        },
      }),
    ).toEqual({
      eligible: true,
      agentId: 'codex',
      storageMode: 'persisted',
      sourceMachineId: 'machine_source',
      vendorHandoffId: 'codex_1',
    });
  });
});

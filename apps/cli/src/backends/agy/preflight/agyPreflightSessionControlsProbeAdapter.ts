import type { PreflightSessionControlsProbeAdapter } from '@/capabilities/probes/preflightSessionControlsProbeAdapterTypes';

/**
 * New-session model probe for Antigravity (`agy`).
 *
 * `agy models` prints `<model-id>\t<Display Name>` on stdout when piped,
 * so PiggerCode can populate the model picker without starting a session.
 */
export const agyPreflightSessionControlsProbeAdapter: PreflightSessionControlsProbeAdapter = {
  connectedServiceAuth: {
    probeModels: 'not-required',
    probeModes: 'not-required',
    probeConfigOptions: 'not-required',
  },
  cliModelsCommandArgs: ['models'],
};

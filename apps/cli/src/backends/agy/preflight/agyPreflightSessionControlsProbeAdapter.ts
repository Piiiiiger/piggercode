import { groupAgyProbedModels } from '@/backends/agy/models/agyModelEffort';
import type { PreflightSessionControlsProbeAdapter } from '@/capabilities/probes/preflightSessionControlsProbeAdapterTypes';

/**
 * New-session model probe for Antigravity (`agy`).
 *
 * `agy models` prints `<model-id>\t<Display Name>` on stdout when piped,
 * so PiggerCode can populate the model picker without starting a session.
 * Effort-suffixed variants (e.g. `gemini-4-neon-{low,medium,high,xhigh}`)
 * are grouped into a single model card with a `Thinking` (`reasoning_effort`)
 * selector to match Claude and Codex.
 */
export const agyPreflightSessionControlsProbeAdapter: PreflightSessionControlsProbeAdapter = {
  connectedServiceAuth: {
    probeModels: 'not-required',
    probeModes: 'not-required',
    probeConfigOptions: 'not-required',
  },
  cliModelsCommandArgs: ['models'],
  transformCliModels: groupAgyProbedModels,
};

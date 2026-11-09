import type { KnownToolDefinition } from './_types';
import { providerShellTools } from './providers/shell';
import { providerReasoningTools } from './providers/reasoning';
import { providerUiTools } from './providers/ui';
import { providerSearchTools } from './providers/search';
import { providerPatchTools } from './providers/patch';
import { providerDiffTools } from './providers/diff';
import { providerAskUserQuestionTools } from './providers/askUserQuestion';
import { providerMachineCommandTools } from './providers/machineCommand';

export const knownToolsProviders = {
    ...providerShellTools,
    ...providerReasoningTools,
    ...providerUiTools,
    ...providerSearchTools,
    ...providerPatchTools,
    ...providerDiffTools,
    ...providerAskUserQuestionTools,
    ...providerMachineCommandTools,
} satisfies Record<string, KnownToolDefinition>;

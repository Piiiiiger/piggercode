import * as React from 'react';
import type { BackendTargetRefV1 } from '@piggercode/protocol';

import { getAgentCore } from '@/agents/catalog/catalog';
import { resolveProviderAgentIdForBackendTarget } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import type { SessionModeOption } from '@/sync/domains/sessionModes/sessionModeOptions';
import { tLoose, type TranslationKeyNoParams } from '@/text';

/**
 * The modes a new session can start in. Every session is its CLI's terminal, which takes a mode only
 * as a start flag: Claude's plan mode has one (`--permission-mode plan`), Codex's collaboration modes
 * have none. So the screen offers an agent's static modes and asks no machine for others.
 */
export function useNewSessionPreflightSessionModesState(params: Readonly<{
    backendTarget: BackendTargetRefV1;
}>): Readonly<{ modeOptions: readonly SessionModeOption[] }> {
    const backendTargetAgentId = params.backendTarget.agentId;
    const modeOptions = React.useMemo((): readonly SessionModeOption[] => {
        const core = getAgentCore(resolveProviderAgentIdForBackendTarget({ kind: 'builtInAgent', agentId: backendTargetAgentId }));
        if (core.sessionModes.kind !== 'staticAgentModes') return [];

        const raw = core.sessionModes.staticOptions ?? [];
        if (!Array.isArray(raw) || raw.length === 0) return [];

        const mapped: SessionModeOption[] = raw
            .filter((opt): opt is Readonly<{ id: string; nameKey: TranslationKeyNoParams; descriptionKey?: TranslationKeyNoParams }> =>
                Boolean(opt && typeof opt.id === 'string' && typeof (opt as { nameKey?: unknown }).nameKey === 'string'))
            .map((opt) => ({
                id: opt.id,
                name: tLoose(opt.nameKey),
                ...(opt.descriptionKey ? { description: tLoose(opt.descriptionKey) } : {}),
            }))
            .filter((opt) => opt.id.trim().length > 0 && opt.name.trim().length > 0);

        const seen = new Set<string>();
        const deduped = mapped.filter((opt) => {
            if (seen.has(opt.id)) return false;
            seen.add(opt.id);
            return true;
        });

        const hasDefault = deduped.some((opt) => opt.id === 'default');
        return hasDefault
            ? [
                ...deduped.filter((opt) => opt.id === 'default'),
                ...deduped.filter((opt) => opt.id !== 'default'),
            ]
            : [
                { id: 'default', name: tLoose('common.default') },
                ...deduped,
            ];
    }, [backendTargetAgentId]);

    return { modeOptions };
}

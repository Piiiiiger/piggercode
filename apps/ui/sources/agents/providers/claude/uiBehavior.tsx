

import type { AgentUiBehavior } from '@/agents/registry/registryUiBehavior';
import { buildClaudeSessionComposerNextMessageMetaOverrides } from '@/agents/providers/claude/buildClaudeSessionComposerNextMessageMetaOverrides';
import { classifyClaudeSessionComposerNonSteerablePayload } from '@/agents/providers/claude/classifyClaudeSessionComposerNonSteerablePayload';
import { resolveClaudeBrowseSourceOptions } from '@/agents/providers/claude/directSessions/resolveClaudeBrowseSourceOptions';
import { claudeGoalActionCapabilityProfile, claudeSupportsEditableGoals } from '@/agents/providers/claude/workState/claudeEditableGoals';
import { buildClaudeSessionHandoffProviderPatch } from '@/agents/providers/claude/sessionHandoff';
import { isClaudeUnifiedAttachedSessionTerminalAvailable } from '@/agents/providers/claude/attachedSessionTerminal';
import { resolveClaudePendingDeliveryLabelKey } from '@/agents/providers/claude/pendingDeliveryPresentation';
import { isCurrentPendingInputServerWireMode } from '@/sync/engine/pending/pendingInputServerWireContract';

export const CLAUDE_UI_BEHAVIOR_OVERRIDE: AgentUiBehavior = {
    pendingDelivery: {
        resolveLabelKey: ({ session, localId, detail }) => resolveClaudePendingDeliveryLabelKey({
            localId,
            detail,
            custodyObservedLocalId: session.agentState?.capabilities?.pendingInputInterruptAndRunLocalId,
        }),
        resolveTransientAction: ({ session, localId, wireMode }) => {
            if (!isCurrentPendingInputServerWireMode(wireMode)) return null;
            const capabilities = session.agentState?.capabilities;
            if (capabilities?.pendingInputInterruptAndRunLocalId !== localId) return null;
            return {
                id: 'interrupt_and_run',
                localId,
                ...(typeof capabilities.pendingInputInterruptAndRunStateAt === 'number'
                    ? { stateAtMs: capabilities.pendingInputInterruptAndRunStateAt }
                    : {}),
            };
        },
    },
    attachedSessionTerminal: {
        isAvailable: ({ session }) => isClaudeUnifiedAttachedSessionTerminalAvailable(session),
    },
    mcpServers: {
        supportsDetectedConfigScan: true,
    },
    workState: {
        supportsEditableGoals: ({ agentId, session }) => claudeSupportsEditableGoals({ agentId, session }),
        resolveGoalActionCapabilityProfile: ({ agentId, session }) => claudeGoalActionCapabilityProfile({ agentId, session }),
    },
    directSessions: {
        browse: {
            order: 20,
            getSourceOptions: () => resolveClaudeBrowseSourceOptions(),
        },
    },
    sessionHandoff: {
        buildProviderPatch: () => buildClaudeSessionHandoffProviderPatch(),
    },
    sessionComposer: {
        buildNextMessageMetaOverrides: ({ configOptionOverrides, metaOverrides }) =>
            buildClaudeSessionComposerNextMessageMetaOverrides({
                configOptionOverrides,
                metaOverrides,
            }),
        getNonSteerablePayloadReason: ({ configOptionOverrides, metaOverrides, session }) =>
            classifyClaudeSessionComposerNonSteerablePayload({
                configOptionOverrides,
                metaOverrides,
                session,
            }),
    },
};

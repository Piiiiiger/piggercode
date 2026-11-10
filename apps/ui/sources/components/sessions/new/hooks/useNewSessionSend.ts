import * as React from 'react';

import type { AgentInputSendOptions } from '@/components/sessions/agentInput/agentInputSendOptions';
import type { NewSessionPromptStore } from '@/components/sessions/new/hooks/screenModel/newSessionPromptStore';
import type { HandleCreateSessionOptions } from '@/components/sessions/new/hooks/useCreateNewSession';
import { blurActiveElementOnWeb, deferOnWeb } from '@/utils/platform/deferOnWeb';

/**
 * Sends the new-session screen: the session starts as the CLI's own terminal, with the text typed
 * here (if any) as its first prompt. A launch the screen was making when it reloaded goes on once.
 */
export function useNewSessionSend(params: Readonly<{
    promptStore: NewSessionPromptStore;
    handleCreateSession: (opts?: HandleCreateSessionOptions) => void;
    resumePersistedLaunchKey?: string | null;
}>): (options?: AgentInputSendOptions) => void {
    const { promptStore, handleCreateSession } = params;
    const submit = React.useCallback((options: AgentInputSendOptions | undefined, capturePromptAtDispatch: boolean) => {
        const promptText = options?.inputTextOverride ?? promptStore.getPrompt();
        // The composer's `mentions[]` envelope goes along with the text.
        const structuredInputMetaOverrides = options?.structuredInputMetaOverrides;
        const carriesText = Boolean(options?.inputTextOverride || (capturePromptAtDispatch && promptText));
        const opts = carriesText || structuredInputMetaOverrides
            ? {
                ...(carriesText ? { inputTextOverride: promptText } : {}),
                ...(structuredInputMetaOverrides ? { structuredInputMetaOverrides } : {}),
            }
            : undefined;
        blurActiveElementOnWeb();
        deferOnWeb(() => {
            handleCreateSession(opts);
        });
    }, [handleCreateSession, promptStore]);

    const resumedPersistedLaunchKeyRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const key = params.resumePersistedLaunchKey?.trim() ?? '';
        if (key.length === 0 || resumedPersistedLaunchKeyRef.current === key) return;
        resumedPersistedLaunchKeyRef.current = key;
        submit(undefined, false);
    }, [params.resumePersistedLaunchKey, submit]);

    return React.useCallback((options?: AgentInputSendOptions) => {
        submit(options, true);
    }, [submit]);
}

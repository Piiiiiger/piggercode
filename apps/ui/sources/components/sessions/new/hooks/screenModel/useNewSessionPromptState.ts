import * as React from 'react';

import { useNewSessionPromptStore, type NewSessionPromptStore } from './newSessionPromptStore';

type AuthoringDraftLike = Readonly<{
    displayText?: string | null;
}> | null | undefined;

/** The new-session prompt: hydrated from the route or a saved draft, then owned by the user's typing. */
export function useNewSessionPromptState(params: Readonly<{
    prompt: string | undefined;
    dataId: string | undefined;
    hydratedTempAuthoringDraft: AuthoringDraftLike;
    hydratedPersistedAuthoringDraft: AuthoringDraftLike;
}>): Readonly<{
    promptStore: NewSessionPromptStore;
    setSessionPrompt: React.Dispatch<React.SetStateAction<string>>;
    hasUserEditedSessionPrompt: () => boolean;
}> {
    const hydratedSessionPrompt = React.useMemo(() => {
        return params.hydratedTempAuthoringDraft?.displayText || params.prompt || params.hydratedPersistedAuthoringDraft?.displayText || '';
    }, [params.hydratedPersistedAuthoringDraft?.displayText, params.hydratedTempAuthoringDraft?.displayText, params.prompt]);
    // RENDER CHURN: the live text is owned outside the render graph. The composer input
    // subscribes to this store and re-renders per keystroke; the screen model does not.
    const promptStore = useNewSessionPromptStore(() => hydratedSessionPrompt);
    // Once the user edits the prompt, their live text is the single source of truth for this
    // screen instance. Later hydration echoes (debounced auto-persist read-backs, focus-driven
    // draft reloads, or another mounted new-session screen writing the same scope key) must not
    // clobber live typing — re-applying a stale snapshot resets the native input's text,
    // selection, and scroll mid-keystroke.
    const hasUserEditedSessionPromptRef = React.useRef(false);
    const setSessionPrompt = React.useCallback<React.Dispatch<React.SetStateAction<string>>>((next) => {
        hasUserEditedSessionPromptRef.current = true;
        promptStore.setPrompt(next);
    }, [promptStore]);
    const hasUserEditedSessionPrompt = React.useCallback(
        () => hasUserEditedSessionPromptRef.current,
        [],
    );
    // Explicit re-entry (a fresh temp-draft handoff or a deep link carrying a prompt) is a
    // deliberate hydration request, not a stale echo — let it apply over live text again.
    const hydrationRequestKey = `${params.dataId ?? ''}\u0000${params.prompt ?? ''}`;
    const lastHydrationRequestKeyRef = React.useRef(hydrationRequestKey);
    if (lastHydrationRequestKeyRef.current !== hydrationRequestKey) {
        lastHydrationRequestKeyRef.current = hydrationRequestKey;
        hasUserEditedSessionPromptRef.current = false;
    }

    React.useEffect(() => {
        if (hasUserEditedSessionPromptRef.current) return;
        promptStore.setPrompt(hydratedSessionPrompt);
    }, [hydratedSessionPrompt, promptStore]);

    return { promptStore, setSessionPrompt, hasUserEditedSessionPrompt };
}

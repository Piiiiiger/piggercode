export type UiDeploymentFreshnessState = Readonly<{ baselineId: string | null; updateAvailable: boolean }>;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** The deployment identity an answer names, or null for an answer without a usable one. */
export function readUiDeploymentId(observedId: unknown): string | null {
    const id = String(observedId ?? '').trim();
    return ID_PATTERN.test(id) ? id : null;
}

export function reduceUiDeploymentFreshness(state: UiDeploymentFreshnessState, observedId: unknown): UiDeploymentFreshnessState {
    const currentId = readUiDeploymentId(observedId);
    if (!currentId || state.updateAvailable) return state;
    if (!state.baselineId) return { baselineId: currentId, updateAvailable: false };
    if (state.baselineId === currentId) return state;
    return { baselineId: state.baselineId, updateAvailable: true };
}

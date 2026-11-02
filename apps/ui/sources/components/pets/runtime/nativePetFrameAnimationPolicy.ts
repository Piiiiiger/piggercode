import type { PetAnimationStateV1 } from '@piggercode/protocol';

export function shouldAnimateNativePetCompanionFrame(params: Readonly<{
    dragState: PetAnimationStateV1 | null;
    reactionState: PetAnimationStateV1 | null;
}>): boolean {
    return params.dragState !== null || params.reactionState !== null;
}

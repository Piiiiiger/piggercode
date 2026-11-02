import type { SessionRuntimeActivitySnapshot } from '@piggercode/protocol';

export type RuntimeActivityApplicability = 'supported' | 'unavailable' | 'not_applicable';
export type RuntimeActivitySlot = 'agentRuntime' | 'executionRuns';

export { SessionRuntimeActivitySnapshotSchema as SessionRuntimeActivityContributionSchema } from '@piggercode/protocol';

export type SessionRuntimeActivityContribution = SessionRuntimeActivitySnapshot;

export type SessionRuntimeActivityContributionHandle = Readonly<{
    report(snapshot: SessionRuntimeActivityContribution, reason: string): Promise<void>;
    markUnknown(reason: string): Promise<void>;
    dispose(): Promise<void>;
}>;

export type SessionRuntimeActivitySnapshotPublisher = Readonly<{
    publish(snapshot: SessionRuntimeActivitySnapshot): Promise<void>;
    subscribeDesiredReoffer?(listener: () => Promise<void>): () => void;
    close(): Promise<void>;
}>;

export type SessionRuntimeActivity = Readonly<{
    applicability: RuntimeActivityApplicability;
    agentRuntimeContributionHandle: SessionRuntimeActivityContributionHandle | null;
    executionRunsContributionHandle: SessionRuntimeActivityContributionHandle;
    bindPublisher(publisher: SessionRuntimeActivitySnapshotPublisher): Promise<void>;
    dispose(): Promise<void>;
}>;

import { describe, it, expect } from 'vitest';

import { MetadataSchema } from './storageTypes';

describe('MetadataSchema', () => {
    it('should preserve terminal metadata when present', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp',
            host: 'host',
            terminal: {
                mode: 'tmux',
                requested: 'tmux',
                tmux: {
                    target: 'happy:win-1',
                    tmpDir: '/tmp/happy-tmux',
                },
            },
        } as any);

        expect((parsed as any).terminal).toEqual({
            mode: 'tmux',
            requested: 'tmux',
            tmux: {
                target: 'happy:win-1',
                tmpDir: '/tmp/happy-tmux',
            },
        });
    });

    it('hydrates legacy attachment-retirement metadata that omitted terminal mode', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp',
            host: 'host',
            terminal: {
                controlServiceabilityV1: {
                    v: 1,
                    attachmentId: 'attachment-retired',
                    state: 'unknown',
                    observedAt: 123,
                    reason: 'attachment_retired',
                    retired: true,
                },
            },
        });

        expect(parsed.terminal?.mode).toBeUndefined();
        expect(parsed.terminal?.controlServiceabilityV1).toMatchObject({
            attachmentId: 'attachment-retired',
            state: 'unknown',
            retired: true,
        });
    });

    it('should preserve sessionLogPath when present', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp',
            host: 'host',
            sessionLogPath: '/Users/test/.piggercode/logs/session.log',
        } as any);

        expect((parsed as any).sessionLogPath).toBe('/Users/test/.piggercode/logs/session.log');
    });
});

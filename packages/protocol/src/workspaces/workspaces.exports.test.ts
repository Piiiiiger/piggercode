import { describe, expect, it } from 'vitest';

describe('@piggercode/protocol/workspaces exports', () => {
    it('exports workspace manifest schemas without pulling in handoff RPC schemas', async () => {
        const workspaces = await import('@piggercode/protocol/workspaces');
        expect(typeof (workspaces as any).WorkspaceManifestSchema?.safeParse).toBe('function');
        expect((workspaces as any).WorkspaceManifestEntryKindSchema.parse('file')).toBe('file');
        expect((workspaces as any).SessionHandoffStatusSchema).toBeUndefined();
    }, 30_000);
});

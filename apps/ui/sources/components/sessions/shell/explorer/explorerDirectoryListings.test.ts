import { describe, expect, it } from 'vitest';

describe('pickExplorerAutoRefreshRound', () => {
    it('asks every open folder in turn, at most a batch per round', async () => {
        const { pickExplorerAutoRefreshRound } = await import('./explorerDirectoryListings');
        expect(pickExplorerAutoRefreshRound([], 3)).toEqual({ folders: [], next: 0 });
        expect(pickExplorerAutoRefreshRound(['a', 'b'], 0)).toEqual({ folders: ['a', 'b'], next: 0 });
        const folders = ['a', 'b', 'c', 'd', 'e'];
        const first = pickExplorerAutoRefreshRound(folders, 0, 2);
        const second = pickExplorerAutoRefreshRound(folders, first.next, 2);
        const third = pickExplorerAutoRefreshRound(folders, second.next, 2);
        expect([first.folders, second.folders, third.folders]).toEqual([['a', 'b'], ['c', 'd'], ['e', 'a']]);
        // A list that got shorter since the last round starts within it.
        expect(pickExplorerAutoRefreshRound(['a', 'b'], 7, 1)).toEqual({ folders: ['b'], next: 0 });
    });
});

import { describe, expect, it } from 'vitest';

import { resolveHappierHomeDirComparableKey } from './happierHomeDirComparableKey';

describe('resolveHappierHomeDirComparableKey', () => {
    it('returns null for empty inputs', () => {
        expect(resolveHappierHomeDirComparableKey('')).toBeNull();
        expect(resolveHappierHomeDirComparableKey('   ')).toBeNull();
        expect(resolveHappierHomeDirComparableKey(null)).toBeNull();
        expect(resolveHappierHomeDirComparableKey(undefined)).toBeNull();
    });

    it('trims and strips trailing separators for POSIX paths without changing case', () => {
        expect(resolveHappierHomeDirComparableKey('/home/Alice/.piggercode/')).toBe('/home/Alice/.piggercode');
        expect(resolveHappierHomeDirComparableKey('/home/Alice/.piggercode////')).toBe('/home/Alice/.piggercode');
    });

    it('normalizes Windows drive paths as case-insensitive and slash-insensitive', () => {
        expect(resolveHappierHomeDirComparableKey('C:\\Users\\Alice\\.piggercode\\')).toBe('c:/users/alice/.piggercode');
        expect(resolveHappierHomeDirComparableKey('c:/Users/Alice/.piggercode')).toBe('c:/users/alice/.piggercode');
        expect(resolveHappierHomeDirComparableKey('C:/Users/Alice/.piggercode\\\\')).toBe('c:/users/alice/.piggercode');
    });

    it('normalizes Windows UNC paths as case-insensitive and slash-insensitive', () => {
        expect(resolveHappierHomeDirComparableKey('\\\\Server\\Share\\.piggercode\\')).toBe('//server/share/.piggercode');
        expect(resolveHappierHomeDirComparableKey('//SERVER/Share/.piggercode/')).toBe('//server/share/.piggercode');
    });

    it('normalizes POSIX-style Windows drive paths to the same key as native Windows paths', () => {
        expect(resolveHappierHomeDirComparableKey('/c/Users/Alice/.piggercode')).toBe('c:/users/alice/.piggercode');
        expect(resolveHappierHomeDirComparableKey('/C/Users/Alice/.piggercode/')).toBe('c:/users/alice/.piggercode');
        expect(resolveHappierHomeDirComparableKey('C:\\Users\\Alice\\.piggercode')).toBe('c:/users/alice/.piggercode');
    });
});

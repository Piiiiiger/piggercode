import { describe, expect, it } from 'vitest';

import { resolveNextConnectedServiceProfileId } from './resolveNextConnectedServiceProfileId';

describe('resolveNextConnectedServiceProfileId', () => {
  it('takes the first free letter, then the letters again with a number', () => {
    expect(resolveNextConnectedServiceProfileId([])).toBe('a');
    expect(resolveNextConnectedServiceProfileId(['a', 'work', 'c'])).toBe('b');
    const alphabet = Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index));
    expect(resolveNextConnectedServiceProfileId([...alphabet, 'a2'])).toBe('b2');
  });
});

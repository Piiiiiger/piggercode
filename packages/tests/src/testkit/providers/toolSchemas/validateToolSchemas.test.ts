import { describe, expect, it } from 'vitest';

import { validateNormalizedToolFixturesV2 } from './validateToolSchemas';

describe('validateNormalizedToolFixturesV2', () => {
  it('fails closed for unsupported protocols in tool-call fixtures', () => {
    const res = validateNormalizedToolFixturesV2({
      fixturesExamples: {
        'weird/prov/tool-call/x': [{ kind: 'tool-call', payload: { name: 'Read', input: {} } }],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected schema validation failure');
    expect(res.reason).toContain('unsupported protocol');
  });

  it('fails closed for unsupported protocols in tool-result fixtures', () => {
    const res = validateNormalizedToolFixturesV2({
      fixturesExamples: {
        'weird/prov/tool-result/x': [{ kind: 'tool-result', payload: { output: {} } }],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected schema validation failure');
    expect(res.reason).toContain('unsupported protocol');
  });

});

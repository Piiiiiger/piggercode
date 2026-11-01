import { describe, expect, it } from 'vitest';

import { applyProductName } from './productName';

describe('applyProductName', () => {
    it('names the app with the configured product and keeps Happier offerings and commands', () => {
        expect(applyProductName(
            'Happier Coder 是一个客户端。Happier can reach the Happier CLI, run `happier attach`, and open a Happier-Session. '
            + 'Happier Voice, Happier-Voice-Agent, Happier Cloud, Happier-Cloud and Happier Desktop stay. Dein Happier-Coder-Konto.',
            'Pigger',
        )).toBe(
            'Pigger 是一个客户端。Pigger can reach the Pigger CLI, run `happier attach`, and open a Pigger-Session. '
            + 'Happier Voice, Happier-Voice-Agent, Happier Cloud, Happier-Cloud and Happier Desktop stay. Dein Pigger-Konto.',
        );
    });

    it('leaves text alone when the product keeps the upstream name', () => {
        const text = 'Happier Coder can reach the Happier CLI.';
        expect(applyProductName(text, 'Happier')).toBe(text);
    });
});

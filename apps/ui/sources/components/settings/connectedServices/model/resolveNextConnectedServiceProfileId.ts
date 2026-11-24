/**
 * The name an account gets when it is added with one press: the first free letter, as the command line's
 * `--profile a`, `--profile b`. Cards show the account's email, so the name only has to be unique per service.
 */
export function resolveNextConnectedServiceProfileId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let round = 1; ; round += 1) {
    for (let code = 'a'.charCodeAt(0); code <= 'z'.charCodeAt(0); code += 1) {
      const candidate = round === 1 ? String.fromCharCode(code) : `${String.fromCharCode(code)}${round}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}

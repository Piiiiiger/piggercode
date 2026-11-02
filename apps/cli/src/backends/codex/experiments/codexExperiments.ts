export function isExperimentalCodexAcpEnabled(): boolean {
  const raw = process.env.PIGGERCODE_EXPERIMENTAL_CODEX_ACP;
  return typeof raw === 'string' && ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
}

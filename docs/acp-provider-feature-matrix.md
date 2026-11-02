# ACP agent capability source map

This page is an internal map to the owners of shared ACP agent behavior. Codex is
the only built-in agent with an ACP mode; Claude Code runs through its own SDK
backend. The owners below hold the ACP facts, so this page does not repeat them
per agent.

## Canonical owners

| Concern | Canonical source |
| --- | --- |
| Agent IDs, resume declarations, tool delivery and support | `packages/agents/src/manifest.ts` |
| Built-in ACP commands, static capability policy, MCP descriptor handling, and transport profiles | `packages/agents/src/acp.ts` |
| Auth status commands and background-check policy | `packages/agents/src/auth.ts` |
| Login launch actions | `packages/agents/src/localCli.ts` |
| Binary resolution and install policy | `packages/agents/src/providers/providerCliRuntime.ts` |
| Negotiated ACP runtime capabilities | `apps/cli/src/agent/acp/AcpBackend.ts` |
| Execution-run availability | `apps/cli/src/agent/executionRuns/registry/executionRunBackendRegistry.ts` |
| UI catalog composition | `apps/ui/sources/agents/registry/registryCore.ts`, `apps/ui/sources/agents/registry/registryUiBehavior.ts` |

## Reading session capabilities

Static declarations decide which product surface PiggerCode offers. The live ACP
handshake is the runtime authority before PiggerCode dispatches an optional method.
Both facts matter: a declaration alone does not prove that the installed agent
negotiates the method.

`sessionStorage.direct` is a storage-mode declaration, not proof of live
takeover, writer safety, transcript following or terminal attachment.

## Reading tool support

`tools.support` records whether the integration is supported, experimental, or
unsupported. `tools.delivery` records how PiggerCode supplies those tools. For
ACP agents, `native_mcp` is paired with the `mcpServers` handling in
`packages/agents/src/acp.ts`; neither field should be restated in an
agent-specific matrix.

## Validation

When these owners change, update their owner-level tests. Authenticated provider
behavior remains unverified until the relevant live recipe runs; a declaration is
not live evidence.

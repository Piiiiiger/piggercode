# Agents catalog (CLI + app + `@piggercode/agents`)

This doc explains how the **Agents catalog** works end-to-end in Happier, and how to add a new agent/provider.

The goal is that both surfaces:
- stay **catalog-driven** (no screen-level `if (agentId === ...)`),
- stay **capability-driven** (runtime checks come from daemon/CLI capability results),
- stay **explicit and reviewable** (no filesystem scanning, no side-effect self-registration),
- share a stable **AgentId contract** across packages.

---

## Key concepts (shared language)

- **AgentId**: canonical id for an agent across packages (CLI + app + server).
  - Source of truth: `@piggercode/agents` (`packages/agents/src/manifest.ts`).
- **detectKey**: CLI executable name used for detection UX and `command -v <detectKey>`-style probes.
  - Source of truth: `@piggercode/agents` (`AGENTS_CORE[agentId].detectKey`).
- **cliSubcommand**: the primary CLI subcommand for this agent (usually the same as `AgentId`).
  - Source of truth: `@piggercode/agents` (`AGENTS_CORE[agentId].cliSubcommand`).
- **flavorAliases**: extra strings we accept for parsing/migration (e.g. `codex-acp`).
  - Source of truth: `@piggercode/agents` (`AGENTS_CORE[agentId].flavorAliases`).
- **Capabilities**: machine/runtime checks produced by the daemon (implemented by CLI) and consumed by the app.
  - Convention (CLI): `cli.<agentId>`, `tool.<name>`, `dep.<name>`.
- **Checklists**: higher-level groupings of capabilities that the app can render as guided setup steps.
  - Convention: `new-session`, `machine-details`, `resume.<agentId>`.

---

## What lives where (sources of truth)

### 1) Shared manifest + runtime metadata: `@piggercode/agents`

Where:
- `packages/agents/src/manifest.ts`
- `packages/agents/src/localCli.ts`
- `packages/agents/src/auth.ts`
- `packages/agents/src/acp.ts`
- `packages/agents/src/sessionModes.ts`

What belongs here:
- canonical ids/types (`AgentId`, `AGENT_IDS`)
- CLI identity contract (`detectKey`, `cliSubcommand`, `flavorAliases`)
- local CLI UX metadata (`machineLoginKey`, login support, docs URL, login launch defaults)
- declarative auth probe metadata
- built-in generic ACP launcher/runtime metadata
- resume contract (`resume.vendorResume`, `resume.vendorResumeIdField`)
- cloud-connect mapping (when applicable): `cloudConnect`

What does **not** belong here:
- app-only visual assets (images/icons)
- app navigation/routes
- CLI implementation details (argv/env/paths)

ACP transport support and session-mode semantics are related declarations with
different purposes. `acp.ts` describes the transport; `sessionModes.ts` controls
preflight discovery, accepted initial mode selection and UI mode semantics. A
mode-bearing transport must not be contradicted by a `none` mode descriptor.

The session-control compatibility reader derives an implicit Plan request from
legacy permission metadata only when the advertised or static options actually
contain that mode. Explicit requested modes retain their pending state even when
discovery is unavailable. ACP usage notifications remain the authority for live
context counts; a mode descriptor or model name cannot supply usage telemetry.

### Session identity in UI (development source)

Session presentation reads `resolveAgentIdFromSessionMetadata` from
`@piggercode/agents`: a declared runtime identity wins over `flavor`, followed
by an unambiguous vendor resume key. Resolve this identity before projecting
compact list metadata or writing its warm cache; the compact `flavor` field
carries that resolved identity, not a competing interpretation of raw metadata.
Unknown Session identity uses the neutral `AgentIcon` mark in lists, cockpit
navigation, and composer controls, and has no avatar provider badge. Composer
engine marks describe the selected or armed continuation Agent, while runtime
policy reads the running Session's canonical identity. A policy default for an
unidentified existing Session is not presentation evidence; an explicit new-Session
selection or armed continuation still supplies its own identity.

### 2) Cross-boundary contracts: `@piggercode/protocol`

Where:
- `packages/protocol/src/*`

What belongs here:
- daemon RPC request/result shapes the app must interpret deterministically
- stable error codes (spawn/resume failures, capability errors, etc.)

Example:
- `packages/protocol/src/spawnSession.ts` defines `SpawnSessionErrorCode` + `SpawnSessionResult`.

### 3) CLI agent catalog: `apps/cli/src/backends/catalog.ts`

This is the CLI’s explicit assembly of backends into a deterministic map:
- `export const AGENTS: Record<CatalogAgentId, AgentCatalogEntry> = { ... }`
- helper resolvers such as `resolveCatalogAgentId(...)`

True provider-specific backend folders live under:
- `apps/cli/src/backends/<agentId>/**`

Generic ACP runtime/catalog machinery lives under:
- `apps/cli/src/agent/acp/**`
- `apps/cli/src/agent/acp/catalog/**`

That split is intentional:
- `apps/cli/src/backends/**` is for provider-owned implementations
- `apps/cli/src/agent/acp/**` is for provider-agnostic ACP plumbing

### 4) App agents catalog: `apps/ui/sources/agents/catalog/catalog.ts`

This is the app’s single public surface for screens:
- screens import from the `@/agents/catalog` entrypoint backed by `apps/ui/sources/agents/catalog/**`
- it composes:
  - **core registry** (`registry/registryCore.ts`) for identity + app config
  - **UI registry** (`registry/registryUi.ts`) for assets/visuals (lazy loaded for Node-safe tests)
  - **behavior registry** (`registry/registryUiBehavior.ts`) for provider-specific hooks

Provider code lives under:
- `apps/ui/sources/agents/providers/<agentId>/**`

---

## App registries (mental model)

There are three layers inside `apps/ui/sources/agents/`:

1) **Core registry** (`registry/registryCore.ts`)
   - identity + app-facing config (translations, settings gating, permissions, connected service UX, resume config, etc.)
   - consumes canonical ids from `@piggercode/agents`

2) **UI registry** (`registry/registryUi.ts`)
   - app-only visuals (icons, tints, avatar overlay sizing, glyphs)
   - imported lazily by the catalog entrypoint so Node-side tests can import `@/agents/catalog` without loading native assets

3) **Behavior registry** (`registry/registryUiBehavior.ts`)
   - provider-specific hooks for:
     - experimental resume switches,
     - runtime resume gating/prefetch,
     - preflight checks/prefetch + issues,
     - spawn/resume payload extras,
     - spawn env var transforms,
     - new-session UI chips + options.

---

## Capabilities + checklists contract (CLI ↔ app)

### Capability id conventions (CLI)

Defined/used in the CLI capability system:
- `cli.<agentId>`: base “agent detected + login status + (optional) ACP capability surface” probe
- `tool.<name>`: tool capability (e.g. `tool.tmux`)
- `dep.<name>`: dependency capability (e.g. `dep.codex-acp`)

### Agent CLI updates (`cli.<agentId>`)

Every `cli.<agentId>` capability is wrapped by `apps/cli/src/capabilities/cliUpdate/providerCliUpdates.ts`, so update behavior is provider-agnostic and driven by catalog facts in `packages/agents/src/providers/providerCliRuntime.ts` (`managedInstall`, `npmPackageName`, `nativeUpdate`):

- Detect, when the CLI is available, adds `installSource` (`managed | native | npm | pnpm | bun | brew | other`), `updateSupported` and `updateCommand`. The single classifier is `classifyProviderCliInstall` (`packages/cli-common/src/providers/update.ts`): it attributes the exact executable the capability reports, using its real path. `native` requires the path to lie under a catalog `nativeUpdate.installPaths` entry. `npm`/`pnpm`/`bun` require the vendor npm package in the path (or a Windows npm shim next to `node_modules/<pkg>`). `brew` requires a `Cellar`/`Caskroom` keg. Anything unproven is `other`, with no command.
- `includeLatestVersion: true` adds `latestVersion: string | null`: the newest version this install's owner would install now. The source is the managed owner's source (GitHub latest release for `github_release_binary`, npm for `managed_package`), else the vendor npm package. For a Happier-managed `managed_package` install, it follows the managed pnpm's release-age rule (`readManagedPnpmMinimumReleaseAgeMs`: the configured `minimumReleaseAge`, else that pnpm's built-in default, 1 day from pnpm 11). That makes it the newest stable version up to npm `latest` that is at least that old. npm, native and other installs report the registry's own `latest`. `null` means there is no source or the lookup failed. The cache is keyed by that policy. Successes are cached per daemon for the installables update-check interval (`PIGGERCODE_INSTALLABLES_AUTO_UPDATE_CHECK_INTERVAL_MS`). Failures are not cached, and `bypassCache` refetches.
- Update action: `install` with `{ intent: 'update', allowVendorRecipeExecution? }`. A `managed` install is reinstalled through the managed install owner. A `native` install runs the vendor updater (`claude update`, `codex update`) on the resolved executable, and only with `allowVendorRecipeExecution: true` (the UI's confirmation). Every other owner returns `update-not-available`, and its message includes the owner's command. Happier never spawns a package manager. The action succeeds only when a fresh detect reports a different version. That re-read uses the snapshot's slow-probe budget (`verifyVersion`), so a slow `--version` is not mistaken for "no version". If the version is unchanged because the managed installer's release-age rule still holds the newer version, the error is `update-held-by-release-age` (for example "0.24.6 is less than a day old; Happier installs it once it's a day old."). Otherwise it fails with `update-not-verified`.
- Old daemons do not report these fields. Clients must offer the update action only when `updateSupported === true` is present, because an old daemon ignores `intent` and runs a plain install.

### Checklist id conventions

Checklist ids are treated as stable API between daemon and app:
- `new-session`
- `machine-details`
- `resume.<agentId>`

### Native resume identity publication (development source)

A newly allocated native id is not necessarily a resumable session. Claude's
`SessionStart` can precede its transcript, and Codex's `thread/start` can precede
native rollout materialization. The CLI's shared
`session/metadata/sessionIdentityPublication.ts` rule preserves explicit existing
resumes but publishes fresh identities only with Agent-native resume evidence:
a matching Claude transcript, or an accepted Codex turn/native attachment
materialization. Observed ids remain available inside the live runner for hook
and transcript correlation while provisional.

This changes publication timing, not the recorded identity format or resume
failure policy. Established identities are retained; unavailable native state
still fails closed without starting a replacement conversation or consuming the
queued prompt. These are development-source contracts, not loaded-runtime or
release validation claims.

### ACP resume (static policy, runtime negotiation)

We do **not** launch an ACP subprocess merely to probe `loadSession` support in normal UI/CLI flows.

Instead:
- resume eligibility is driven by the selected backend's static agents-catalog `supportsLoadSession` declaration
- when a declared-capable backend is actually resumed, its ACP `initialize` response must also negotiate `agentCapabilities.loadSession`; a mismatch fails before `session/load`
- explicit “resume inactive session” is **fail-closed**: if `loadSession` fails, we surface the error instead of silently starting a fresh vendor session
- any ACP capability probing (e.g. `includeAcpCapabilities`) is reserved for opt-in diagnostics / e2e probes, not day-to-day UX

Built-in ACP `supportsModes: 'no'` disables mode projection and both mode mutation paths at the shared backend.

### Native-login import

Native-login import in development uses each cloud-connect catalog target's optional `importSources` and `importCredentials` hooks. `runConnectedServiceImport` admits the selected service and the relay's revision-guarded write capability before invoking a provider reader, normalizes its result through the existing OAuth credential-record builder, and stores it through `storeConnectedServiceCredentialForAccount` with `same_account_or_empty`. The CLI and `daemon.connectedService.import` consume that same owner; the machine response contains status and source/profile identifiers, never credential material. There is no shared mandatory refresh or native credential write. Provider readers retain authority over native file/Keychain/keyring selection. A lost storage acknowledgement is `storage_result_unknown`, requiring profile reconciliation before another import; the app holds imports and uses its existing profile refresh path. Owner and rendered tests cover these contracts; actual native-platform reads and authenticated imported-account launches remain unverified.

### Dynamic model lists

Whether a provider's model list is resolved at runtime is one catalog fact:
`AGENT_MODEL_CONFIG.<agentId>.dynamicProbe` in `@piggercode/agents`.

- `'static-only'` — the curated `staticModels` list is the whole truth. The app does not run the
  preflight models probe and ignores any `sessionModelsV1` the session publishes.
- `'auto'` (default when omitted) — the app runs the preflight models probe on the new-session
  screen and on demand in an existing session's engine details, and consumes the runtime's
  `sessionModelsV1` list. These readers share this flag.

Model discovery is owned by `apps/ui/sources/sync/ops/modelDiscovery.ts`, shared by the picker
hook and voice catalog requests. Its existing persistent probe cache serves stale choices while
revalidating; failed refreshes retain the last successful observation and its timestamp. Discovery
is scoped to the machine/server, backend target, working directory, profile, runtime and connected
service context. Existing-session details probe only while mounted, including inactive sessions;
refreshing choices does not resume the session or claim that a requested model has been applied.

Manual refresh passes `bypassCache` through the capability RPC and generic probe to provider-owned
caches. Results distinguish the successful observation time (`observedAt`) from a failed latest
attempt (`refreshError`). This prevents a daemon cache hit or failed refresh from acquiring a new
24-hour success lifetime in the UI. Older daemons safely ignore the optional bypass parameter but
cannot guarantee a forced provider refresh; both client and daemon must support it for that behavior.
Successful empty catalogs remain authoritative, while an unavailable observation retains previous
choices or the curated fallback. A stale catalog's omission is not rejection of an already requested
or applied model.
Runtime catalog timestamps describe model-list observations. Current-model-only updates preserve
that timestamp, so applied-model telemetry cannot make an old list override a newer probe.

A provider that publishes `sessionModelsV1` from its runtime and is left on `'static-only'` has an
active producer with its consumer gated off — the published list is silently discarded. Flipping
that flag is a user-visible change: the app switches to the dynamic row builder, which carries less
per-model metadata than the static one, so audit what the dynamic path drops before flipping.

Dynamic providers whose runtime starts lazily publish `sessionModelsV1` only after that first
prompt, so the in-session model picker would offer nothing but the current model and freeform
custom until then. To close that window, the new-session screen seeds the server-persisted
`sessionModelsV1` from the wizard's own preflight probe at spawn
(`sync.publishSessionModelsSeedToMetadata`, wired in `useCreateNewSession`). The seed is
deliberately seed-only: if the runtime has already published for this session, the write is a
no-op, and the runtime re-publish stays authoritative. It only applies to `dynamicProbe !==
'static-only'` agents with no curated static list.

When an agent provides a raw preflight models hook, that hook owns discovery and its fallbacks;
failure retains the last good result instead of starting another generic backend probe. Agents
without a raw hook retain generic discovery.

ACP publication distinguishes a complete catalog (including `[]`) from a current-model-only update.
Complete observations replace membership in both metadata aliases; partial current-model updates
preserve the existing catalog and its observation time. Producers can supply the original
`observedAt` when reprojecting options in a previously observed catalog; this does not renew its
freshness. Config-derived model catalogs use the same distinction.

A provider with both surfaces needs **one owner** for the model list. Claude's is
`apps/cli/src/backends/claude/models/resolveClaudeModelCatalog.ts`: the preflight probe adapter and
the in-session `sessionModelsV1` publisher both read it, so the two pickers cannot disagree about
which models exist or which effort tiers they report. Its provider-owned cache identity is the
normalized endpoint, credential kind, and full SHA-256 credential hash. A warm cache entry avoids a
network request; a cold session start may fetch the catalog before publishing the resolved models.
For Claude, a successful account response is authoritative for membership and API capability/context
facts; curated rows only enrich matching ids and serve as the fallback before the first success. A
later failed refresh retains the bounded last successful account snapshot, serves it during the
failure cooldown, and retries discovery after that cooldown without replacing it on repeat failure.
The session publisher combines the latest catalog contribution with the latest Agent SDK
contribution; historical persisted unions do not establish current membership. Replacing a
contribution removes its withdrawn rows and optional controls.
Effective-current-model observations supply the selected model's context facts through that same
reconciler without granting historical catalog rows membership again.
In development source, observed reasoning effort follows that same current-model contribution:
statusline reports, verified terminal-control results, and explicit SDK/legacy launch effort after
successful provider initialization update the active control value. Catalog refreshes preserve that
observation without renewing catalog freshness or treating a pending metadata request as applied.
When no effort has been observed, the existing catalog default remains a control fallback rather
than a verified runtime observation. Override retirement uses the same alias-aware model support
policy as launch, so a missing bare-alias catalog row cannot erase a supported request.
Effort tiers are resolved once when the session mode is built and travel on the mode, so spawn-time
resolution and launch-option hashing see the same value and hashing stays pure.

Claude dynamic discovery is one canonical allow/deny decision at that catalog owner. The account
setting `claudeDynamicModelProbeEnabled` defaults to `true`; setting it to `false`, or setting
`PIGGERCODE_CLAUDE_DYNAMIC_MODEL_PROBE_ENABLED=0` in the CLI/daemon environment, returns the static
catalog before resolving any credential or reading the provider-owned cache. The environment value
is a local kill switch and cannot re-enable discovery after the account setting disables it.

Provider-owned probing:
- The CLI capability RPC resolves the selected backend profile once before any model, mode, or
  config-option or native-catalog probe. It uses the same profile environment and Saved Secret resolver
  as session startup, layers selected session environment overrides, then prepares connected-service
  materialization. A native-catalog request with an explicit GUI-materialized environment map uses
  that map as the profile authority, including an empty map for machine-environment secret choices.
  Provider adapters consume the
  resulting `processEnv`; they must not rebuild a competing profile environment from ambient state.
- In development source, adapters declare selected-account preparation for each discovery method:
  `provider-owned` resolves credentials inside its account-aware owner, `materialized-env` uses
  the shared materializer, and `not-required` describes authentication-independent static data.
  Claude model discovery uses its account-aware model catalog; its modes and config-option queries
  return static data without launching Claude. Materialized probes pass `materializationPurpose:
  'probe'` through the common owner. Provider materializers consume that purpose to isolate config
  and state in the temporary probe root without adopting persisted provider state.
- Implement the probe in `apps/cli/src/backends/<provider>/preflight/**` and register it through
  `getPreflightSessionControlsProbeAdapter`. Type it as `PreflightSessionControlsProbeAdapter` —
  that is the shape the caller invokes, and its params carry `connectedServices` and
  `accountSettings`. Typing it as the narrower `PreflightModelsProbeAdapter` compiles but silently
  drops those inputs.
- Set `resolveModelsProbeVariant` on the catalog entry whenever the probe result depends on
  something other than the agent id — runtime flavor, auth method, or the bound connected account.
  The returned string partitions the probe cache; without it, results computed for one account or
  runtime mode are served to another. Codex uses this generic cache variant; Claude instead declares
  provider-owned caching and keys its catalog by the effective endpoint and credential identity.
- Model probes fail closed to the static catalog. A probe that cannot authenticate returns `null` rather than
  probing with whatever credential happens to be in the daemon's environment.

In development source, `capabilities.invoke` exposes `probeCatalogs` on each CLI capability through
the same preflight adapter. Its `PreflightSessionCatalogsV1` result separates native slash commands
from typed skills, with explicit support flags and normalized items. Codex app-server reads
`skills/list` without starting a thread, and Claude initializes its native command catalog. ACP
transports observe `available_commands_update` after an ephemeral provider session opens, without
submitting a prompt. A slash skill is still a slash command unless the transport exposes a typed
skill catalog. Unavailable discovery returns `preflight-catalog-unavailable`, allowing recovery
rather than presenting it as unsupported. Concurrent requests share one preflight launch only when
their complete resolved launch scope matches; the composer lifecycle owns the successful selection
snapshot.

Catalog requests use one deadline for account settings, profile and connected-account preparation,
backend readiness, and native discovery. Expired or cancelled preparation cannot start a native
probe. A cancelled caller leaves a shared launch running for its remaining callers; the final caller
awaits cleanup of native resources and authentication materialization already acquired. A fresh
request can start a new ephemeral launch while an aborted launch finishes cleanup. Malformed
connected-account bindings fail at catalog ingress rather than falling back to ambient credentials.
A selected connected account also fails before native discovery when its adapter cannot materialize
that scope; explicit native-only bindings continue to use native authentication.

The new-session composer demands discovery only for `/` or `$` suggestions and scopes that snapshot to the selected machine,
server/account, backend, project, profile, and authentication context. Local slash rows remain
available while discovery is pending. A selected native skill retains any agent-supplied identifier
and its source reference through structured input rather than becoming a library import. Catalog
reference identifiers synthesized for lookup are not native invocation identifiers; entries without
a native identifier retain name/source-path resolution.

Pre-session discovery requires managed prerequisites to be ready: the canonical launch installable
owner runs in readiness-only mode and does not install or start background updates. Actual session
launch retains its configured installation policy.

## Connected-account quota recovery (development)

Claude OAuth profile normalization belongs to
`packages/protocol/src/providers/claude/oauthProfile.ts`; the agents package
re-exports that owner. Credentials retain the provider-attested organization UUID
alongside subscription metadata. Protocol owns the credential organization reader
and required-organization policy, so shared quota machinery uses one decision
rather than competing provider lists.

Claude usage records combine the provider user with the organization through the
existing `quotaScope: organization` and `quotaScopeId` key fields. Different
profile labels for that same context share evidence; the same user in another
organization has a separate record. Unknown organization identity remains
provisional and cannot establish shared profile ownership. The existing credential
refresh coordinator can qualify older credentials using the same token's matching
profile response, without rotating an unexpired token. It publishes the context
through the existing credential revision, lease and distribution lifecycle;
metadata enrichment does not clear quota cooldowns or credential-health failures.
Exact current-token and user proof can still authorize profile-local recovery
when the organization is unknown. The existing runtime quota entry retains the
actual verified token fingerprint; a different current token invalidates that
unscoped evidence. Local entries use the existing freshness and polling budget
without establishing global usage aliases.
Runtime failure attribution and direct-account recovery compare that same
context; an ambiguous live identity cannot authorize mutation of the runner's
old launch profile. The public Session runtime-issue shape is unchanged.

Credential metadata projects the attested organization through the protocol
credential builder. The server invalidates usage-source aliases when that account
context changes, while ordinary same-context token rotations retain their usage.
Reset redemption rechecks the token's profile and refuses a different known
organization before sending a debit request.

The canonical UI quota store lives in the connected-services sync domain. It
checks current credential context, invalidates the exact binding after a changed
credential write and rejects late results from retired requests. Transient
credential-read failures retain accepted cached evidence; a successful credential
replacement with missing or changed context cannot keep the previous context's
quota.

Provider-owned quota fetchers discover recovery credits and implement the existing
consume hook. The daemon quota coordinator owns selection, operation joining,
receipts, ambiguous-debit holds, post-operation refresh and account-usage publication.
Account and Session UI consume those shared facts; they do not redeem directly.
The shared agent declaration supplies reset support to both pool policy admission
and UI configuration. Subscription support does not imply API-key or setup-token support.

Claude's OAuth integration evaluates reset programs through the usage endpoint with
the provider-native CLI HTTP identity. Its installed-version resolver is shared
with other Claude HTTP consumers. Supplemental reset reads preserve the ordinary
usage response. Grant balance and current usability are separate: only redeemable
units enter `availableCount`; saved unusable grants remain non-actionable details.
Redemption resolves the organization with the same OAuth credential and submits one
program-specific POST without retries. Automatic requests additionally carry the
exhausted allowance ids and require fresh matching provider evidence.

The canonical consume-key owner includes the inventory observation for named
credits when supplied, permitting another legitimate use of a multi-use grant.
Caller-supplied RPC keys remain unchanged. The coordinator joins overlapping uses
of the same selector and retains an uncertain debit across newer observations.
If an automatic operation proves no effect, a waiting manual request or request
for a different exhausted allowance re-enters that same consume owner. Successful
or uncertain debits remain shared, preventing a second redemption.
No newer snapshot alone proves that a lost reset response had no effect.

The external contract basis is the October 2026 read-only OAuth probe and
[oh-my-pi's pinned reset implementation](https://github.com/can1357/oh-my-pi/blob/ca18a903c5d7c946c26c728a66d3a9151f0c26b1/packages/ai/src/usage/claude-reset.ts).
The POST contract is source-backed; live redemption and server request-id
idempotency guarantees remain unverified.

## Node-safe imports (tests)

Some tests import the app agents catalog in a Node environment. Avoid importing native/icon modules from code that executes during those imports.

Patterns we use:
- the catalog entrypoint lazy-loads `registry/registryUi.ts` to avoid loading image files in Node.
- if a provider behavior needs a React Native component (e.g. action chips), lazy-require it inside the hook.

---

## Anti-patterns (please don’t)

- Don’t “auto-discover” backends by scanning the filesystem. We want deterministic bundling and explicit reviewable changes.
- Don’t do side-effect self-registration (“import this file and it registers itself”). It makes ordering brittle and behavior hard to audit.
- Don’t hardcode agent-specific logic in generic screens; add a typed hook in the provider’s `uiBehavior.ts` instead.
- Don’t import native assets from code that must run in Node tests (keep assets in `registry/registryUi.ts` and lazy-load).

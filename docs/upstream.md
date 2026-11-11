# Upstream Happier

PiggerCode is a fork of [Happier](https://github.com/happier-dev/happier). It started from upstream commit
`97dd7ad63576` (2026-10-26) and has since become terminal-only (see cli-architecture.md), so most upstream changes
no longer apply. This page records how far upstream has been reviewed and what each review took.

Baseline: `7b37d65ca75e58560f8f3ca850958ac5407d2e75` (upstream dev, 2026-11-08)

The baseline is the upstream commit that every earlier upstream change has been reviewed through: ported, deferred
(listed below) or not applicable. Keep the line's format: a monitor reads it to count the upstream commits after it.

## Deferred

Upstream changes that apply to PiggerCode but wait for a later round.

| Upstream | What it fixes | Why it waits |
|---|---|---|
| 8a2d010 | The app's sync stays stuck after a stalled read or a failed socket dial, with Retry disabled. | 35 files across the HTTP client, the connection supervisors and apiSocket, which the fork has changed; it needs its own round with the sync tests. |
| 180d294 | Sync recovers from snapshots instead of replaying list refreshes; the server compresses responses. | 36 files in the server and the sync core plus a new dependency. The compression part could go alone. |
| f03e423 | A follower of a shared terminal reader stays on "connecting" without Retry. | Only the side-panel terminal tab can be a follower, and the hook it rewrites has diverged. |
| 79907bb | Another account signing in on the same machine keeps the previous account's session data. | One account per machine today; 25 files. |
| 9351d35, a3ec3cc, d54c905 | Lazy schema and SDK loading for startup memory. | Broad codemods, much of it in chat code that is going away; measure after that. |
| e6c1097, 288b7a2, c07045b, 9bc2a94 | Cached Claude titles for the resume picker. | Measure a picker listing on a large `~/.claude/projects` first; port the four together. |
| 400e88d, 9c0f796 | The Codex resume picker falls back to raw prompts when `codex app-server` answers slowly. | Measure first (`[directSessions.codex.appServerCandidates] list finished` with `timedOut: true`). |
| 0d3cb9e | A resumed session loses the environment profile it started with. | Only matters when environment profiles are used. |
| 2bf9685 | `self update` runs its repair step with the old binary. | Low impact; touches renamed release-runtime ids. |
| 67123c8 | Release builds stage native PTY addons per target. | Needs the fork's release flow checked first. |
| 698c8f3, 305d862 | Back and Forward through session visits in the desktop app. | A product choice, not a defect. |
| 02687f0, ce96203 | Details of the update status screen. | Low value; they conflict with the fork's update screen. |

## Reviews

### 2026-11-11: `97dd7ad63576..7b37d65ca75e`

582 non-merge commits: 150 change only tests or docs, 67 change only files the fork has deleted, and 78 of the other
365 were checked against the fork's code after a pass over their subjects.

Ported:
- CLI: exact tmux targets (8c7e2f9); the daemon's lock handover during a self-restart (33f6528, heartbeat part);
  process-only daemon ownership needs scope evidence (93a8071); Codex spawns need a resolvable `codex` (21060ed);
  an unreadable `settings.json` is no longer overwritten with defaults (2a1eeac); service drift checks keep the
  installed options and ignore the inherited PATH (4ff15b4, a3121ed); the tool unpacker exits naturally (98c8b26);
  title scans parse only title lines (118a3df, without its title cache); Codex review threads stay out of the resume
  picker (01e3948); retryable socket ack timeouts (1d2f4f6); no outbox retry spin (956b197); journals survive read
  errors (52273fb); unchanged metadata is not rewritten (8468450).
- Protocol: standalone bearer tokens are redacted (cbaee1e).
- Server: machine presence survives socket replacement (a105a2f); the SQLite readiness probe uses its own connection
  (e681d9f); session heartbeats coalesce until persistence admits them (2ffdc7f).
- App: the new-session composer locks once Send is accepted (06439e4); an untouched New Session saves no draft
  (6d2e18e); editors retire after their draft is deleted (318f10f); IME composition autosize (3813c6a, 9bca00f);
  unread sessions on offline machines (5227e3e); lifecycle facts reconcile independently of row timestamps (e77cf1f);
  unchanged machine entries stay stable (ce01b24); a presented connection failure holds across retries (f724876);
  Unistyles updates web styles rule by rule (156985d); the desktop app remembers its macOS window frame (a487b2e).

Not applicable: chat runners and the chat UI, ACP and the other agents, connected services and quotas, voice,
mobile, Windows, and upstream's release automation, website and docs.

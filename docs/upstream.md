# Upstream Happier

PiggerCode is a fork of [Happier](https://github.com/happier-dev/happier). It started from upstream commit
`97dd7ad63576` (2026-10-26) and has since become terminal-only (see cli-architecture.md), so most upstream changes
no longer apply. This page records how far upstream has been reviewed and what each review took.

Baseline: `05a0c46b0f18172cdaa5f0297fc352f98b0648bf` (upstream dev, 2026-11-26)

The baseline is the upstream commit that every earlier upstream change has been reviewed through: ported, deferred
(listed below) or not applicable. Keep the line's format: a monitor reads it to count the upstream commits after it.

A monitor tells the owner when upstream ships a stable release that the baseline does not contain. The owner starts
the sync; it lists the upstream changes it recommends merging, and only those the owner approves are ported.

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
| 52d077e, b825a99 | A session the relay no longer has stays in the app's list; upstream retires it on authoritative absence. | Needs a retirement path in the app's sync that the fork lacks; belongs with 8a2d010 in a sync round of its own. |
| 7e9086c | Session list ordering scope, project headers without a path, and the list viewport. | Several changes in one commit; 12 of its files diverged in the fork, for a small gain. |
| 1c7d9fa, e266046, 9c3cf41, a53d964, 8dccbfe, 8714118, d3fe614 | A daemon reply too large for the relay socket (its packet limit, or what a slow uplink uploads before the pong deadline) is refused with `RPC_RESPONSE_TOO_LARGE` instead of losing the socket, and a very large `git status` snapshot is cut to fit one reply. | One design: the ceiling without the cut refuses snapshots that arrive today. Needs protocol and UI changes; port all seven together. |
| 59ae698, 017ebc4, 988501a, 9fe69bd | The desktop app remembers its window size and position on Linux (and Windows). | A new Rust module of about 500 lines: a product choice for the Linux desktop app. |
| ec68dc5, a0e39c3, 3ac2129, ab4deee | Provider CLI versions are cached by binary identity. | Motivated by slow Windows spawns; measure on Linux and macOS first. |
| c366ae4 | Horizontal overflow drags on Android. | A new Android native module; its consumers are mostly chat content. |
| 70043d8, 6ce9bc2, e56f65c | Desktop notification clicks open their session; system notifications on the web. | Features the fork does not have: product choices. |
| 087dee6 (resize handle), 761c288 (sidebar `zIndex`) | The docked pane's resize handle sits outside its scroll area. | Outside the sidebar the fork's route content covers the handle (stacking order): 761c288's `SidebarNavigator` `zIndex` is that fix. Port the two together and check dragging the handle in a browser. |
| fb6723292a (runner identity) | Stop, restart and exit observation use the runner that reported itself instead of the launcher's pid. | Not reachable today: on the owner's VM (2026-11-26) every tmux `pane_pid` was the piggercode runner itself (direct argv launch, `systemd-run --scope` execs in place, an oversized command's script ends in `exec`). Port when a launcher and runner can differ. |
| d32a6a82f2 | Each session runner's socket receives every session update of the account. | Terminal sessions publish little; count update frames per runner before porting (server rooms, event router, CLI socket, protocol). |
| 9f782a925b | Usage rings count down the remaining quota. | A design choice; only the accounts page shows rings in the fork. |
| 81cd121948 | Connected-service network failures are explained instead of "Failed to fetch". | Wording only; 33 files, most of them translations, and a classifier the fork lacks. |

## Reviews

### 2026-11-26: `e26eaae7515c..05a0c46b0f18`

84 non-merge commits: 12 change only tests or docs, 16 change only files the fork has deleted, and the other 56 were
checked against the fork's code. From this round on, the recommendation list is audited by Codex and Gemini before the
owner sees it; both found two items the first pass had marked not applicable (f03ff22, 5881f3e), and Codex withdrew its
proposal to port the runner-identity half of fb67232 after the VM's live process tree showed it unreachable. The owner
approved the agreed list.

Ported:
- CLI: a terminal hangup (SIGHUP) runs the runner's shutdown, so the session reports its end (fb67232, that half
  only); the Python PTY relay sets TERM from the requested terminal name (6dd45dc; the Bun service form hit this on
  2026-11-18, when every terminal view failed with "terminal does not support clear"); the daemon no longer writes
  `cgroup.procs` itself and places Linux sessions only through `systemd-run` scopes (f9f0254).
- CLI, relay and app: imported direct sessions keep their original creation and activity dates (6ccd30b, the link
  part; the Codex native-history timestamps are chat-only).
- App: "New session in folder" files the session into that folder (6206fc3, 7e46ccf); a language change is flushed to
  the account settings before the reload (4f3633b, through the fork's existing flush instead of upstream's durability
  parameter); the file editor refreshes before leaving edit mode (dfbe2fe); Monaco's text box counts as an editable
  target for shortcuts (339774b); the new-session draft status badge follows persistence changes (24731ff); one
  trailing re-measure per session-list drag, scoped to each drag (179cfb6, 6ef7c3f); inline Markdown in table cells
  (f03ff22); the new-session wizard scrolls clear of the composer (5881f3e).

Offered as optional and not taken: 761c288's icon centring in `PrimaryCircleIconButton`, 600631a (pass a custom
`XDG_CACHE_HOME` or `PLAYWRIGHT_BROWSERS_PATH` into tmux windows). Deferred: see the table (fb6723292a's runner
identity, d32a6a82f2, 9f782a925b, 81cd121948, and 761c288's `zIndex` with 087dee6). Not applicable: the Claude chat
runner's model and session-identity fixes (d015f54, 2989fe2, ae31cce, 15b268f, 3d24737, 038d19a), unified-terminal
prompt injection (377bcdb, 1c3436b, 31c1fd5), generated context in transcripts (5278a70), Direct sessions that start in
chat mode (08a6320), the Claude environment allowlist the native path does not use (62ef0ed, 6c5439f), a dev-only
environment forward (b48d051), composer, transcript and send-mode changes, usage-limit recovery and quotas, ACP and
MCP, Windows and Herdr, iOS (2889701), Android push, and upstream's release CI and changelog.

### 2026-11-22: `7b37d65ca75e..e26eaae7515c`

174 non-merge commits: 24 change only tests or docs, 28 change only files the fork has deleted, and 75 of the other
122 were checked against the fork's code after a pass over their subjects. Its ports were shown to the owner after the
release, before this approval step existed.

Ported:
- CLI: failed account settings refreshes back off until they succeed or the socket reconnects (a5402e7); a session
  detail response must carry the requested id (b9efdda); each process logger keeps a 10 MiB tail of its own file and
  the logs folder a 1 GiB budget (d26c185, 0084503, c680de9), and the fork adds that the daemon service's launchd
  stdout/stderr logs are never pruned; managed pnpm installs extract the tarball's hardlinks (7485f4e).
- App: popovers keep their clicks and escape clipped hosts (087dee6, the popover parts); session list drag fixes
  (af3099a, 893f18f); menus keep their highlight across equal item lists (3f4ed88); dropdowns grow to the window
  height (197c250); selected radio dots stay visible in every theme (5ffb5d5); a multiline input is not refocused
  after scrolling (0812d9b); the composer re-seats after a modal (d2c2c6b); native popovers fit above the keyboard
  (d608762); Android Back closes the top modal (4ac2e57); the file tree refreshes every expanded directory (beef962).
- Desktop: the pet overlay shows its window only when it is hidden (ca86293, 9bb6211).

Deferred: see the table above (52d077e to 179cfb6, and the reply ceiling with the snapshot cut). Not applicable:
mounting only the presented session history entry on the web (5acfeb7: the fork opens sessions singular, so no visits
pile up, and the gate lost the phone cockpit's tab history); chat runners, turn records and the pending queue
(c4da746, bcf00a7, 0b54ab5, ad40c30, 1536716, 0ccb85a); the Codex native history projection (e47ab99, 9308855,
de99893); the chat runner's PTY screen model (7ccbc61, 7a54763); quotas and connected services, voice and read-aloud,
ACP, Windows-only changes, Postgres-only server changes (the relay runs SQLite), and upstream's release CI.

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

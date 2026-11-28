# T3 Code

T3 Code is a minimal GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx) and serves web, desktop, and mobile clients.

You can think of T3 Code as an open source "bring-your-own-subscription" alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor.

## What makes T3 Code special?

We have over 500,000 users who love T3 Code. It's important we maintain the things they love as we continue to iterate on the product. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks (our MIT license covers source code only, not T3 Code's trademarks or branding; see [TRADEMARK.md](TRADEMARK.md)). We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (`t3`) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React Native app for both iOS and Android, available on the App Store and Google Play. The mobile app allows for connecting to any T3 Code server to control work remotely.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most T3 Code contributions will come from T3 Code itself, often controlled remotely. This means you should be careful about accessing data, killing dev servers, and other things that may damage the T3 Code instance that the contributor is using.

## Terminology

- **you** = the agent reading this file. **we / us / maintainers** = Theo, Julius, and the people building T3 Code. **user** = person driving coding agents in T3 Code. **agent** = coding agent running inside T3 Code.
- Domain terms (environment, project, thread, turn, provider, checkpoint, etc.): [00_glossary.md](docs/internals/00_glossary.md).

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Reading or copying from it is fine. Never start a server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** Chat view, Settings, command palette, and keybindings. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (Electron shell/IPC), and mobile (React Native). Shared logic lives in `packages/client-runtime`.
- **Providers.** Every provider adapter needs a decision, even if the decision is "not supported here".
- **Agents.** Capabilities a user triggers should be service methods reachable by MCP tools and scheduled tasks, not inline handler code.
- **Contracts.** Wire changes go in `packages/contracts` so server, web, mobile, and desktop follow.
- **Reverse states.** Every way in needs a way out and a way to see it (snooze/unsnooze, close/reopen). A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel; multi-device and multi-environment.
- **Languages.** Translate user-facing copy in `apps/{web,mobile}/src/i18n/translations` (`vp run i18n:generate` / `vp run i18n:check`) and `apps/marketing/src/i18n`. See [14_i18n.md](docs/internals/14_i18n.md).
- **Docs.** Check whether the change makes existing guidance inaccurate. Follow [Documentation](#documentation).

## Dev servers and test data

See [00_development.md](docs/operations/00_development.md) for setup, ports, seeding (`vp run migrate-dev-db`), and [reusable dev auth](docs/operations/00_development.md#reusable-dev-credential). Agent-specific rules:

- **Worktree setup:** Wait while `.t3/setup-running` names a live PID; do not run `vp i` concurrently. If no `.t3/setup-*` marker exists, run `vp i` yourself.
- **Process lifecycle:** Start dev servers, Metro, and builds from your own shell so they exit with your session—never detach with `systemd-run`, `nohup`, `setsid`, or `tmux` unless asked. Stop background tasks with your harness's own stop (`vp` does not forward SIGTERM to child Vite/server processes).
- **Sharing (`vp run dev --share`):** Wait for `pairingUrl:` and hand the full URL to the user. Never wire `tailscale serve` by hand, open the URL yourself, or consume the user's one-time pairing link. Mint another with `node apps/server/src/bin.ts pair` if needed.
- **Test data:** Always copy in (never symlink) and refresh `statev2.sqlite`, not `state.sqlite`. Bring `secrets` / `settings.json` only if the flow under test needs them.
- **Extra checkouts:** Put `git worktree add` next to this worktree, not in `/tmp`, and remove it when done.

## Verifying

- Before you push, run `vp run check:changed`. **Do not run repo-wide checks** (`vp check`, `vp run -r test`, `vp run -r typecheck`) unless asked—CI owns the full suite.
- Iterate with `vp test run <files>` (add `-t "<name>"` for large files) and `vp run typecheck` (`effect-tsgo tsrs --noEmit`). Run `node -e` snippets from the owning package (`effect` does not resolve from repo root).
- Follow [15_testing.md](docs/internals/15_testing.md) for what to test, bug-fix proof, draining async work (no sleeps/polling), web browser tests (`await using screen = await render(...)`), and real-app [Scenarios](docs/internals/15_testing.md#scenarios) (`vp run scenarios:prove`).
- Give user-visible frontend changes one integrated pass in a real client: `test-t3-app` for web, `test-t3-mobile` for mobile (primary agent only; subagents do not launch dev servers). Inspect the rendered result and walk the flow as a user using the feature—checking layout, visual hierarchy, and ergonomics—and fix anything rough until you are satisfied before handing back. Use the free `Replay (dev)` provider unless the change depends on a real provider (then pick its cheapest model, e.g. Haiku or Luna). On mobile, run `vp run mobile:install <ios|android> [device-id]` before Metro rather than rebuilding from scratch.

## Evals

`evals/` checks how real models behave with T3 Code's model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before changing that text, read [evals/README.md](evals/README.md) and run the evals it names. When fixing a model behavior bug, add a case that fails before the fix.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- `origin` is not always GitHub. Check `git remote get-url origin` before your first forge command and use that forge's CLI and skill. See [Forge mirror](docs/operations/00_development.md#forge-mirror-optional).
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images; motion or timing needs a short video. Upload PR evidence to GitHub—never commit PR-only screenshots or assets.
- One request is one PR. Split only when asked. Outside contributions follow [CONTRIBUTING.md](CONTRIBUTING.md#one-problem).
- When babysitting: call `watch_pull_request` and end your turn. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new; stop when bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields, methods, constants, timeouts, or migration numbers, narrate control flow, maintain file catalogs, or append PR summaries. Anything that can drift will drift; types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks in the shipped product's voice, without implementation details or contributor tooling. Focus on what a feature does, how to start, and anything unintuitive—not descriptions of buttons, layouts, or UI tweaks.
- `docs/operations/` holds maintainer setup, release, and debugging runbooks. Keep end-user server instructions in `docs/user/`.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files (keep temporary material outside the worktree).
- Track active maintainer work in its GitHub issue or project item; external proposals belong in Ideas discussions. A merged PR is the implementation record.

## Where code lives

- `apps/server` - WebSocket, event-sourced orchestration (`Orchestrator` → `EventSink` → `EffectWorker`), providers, checkpointing. Read [02_effect-services.md](docs/internals/02_effect-services.md) and `.repos/effect/LLMS.md`.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it; `apps/mobile` is React Native; `apps/marketing` is the site.
- `packages/contracts` - Effect/Schema wire contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client connection and domain state shared by web and mobile.
- `.repos/` - vendored read-only references. Never edit or import from them (`vpr sync:repos` updates them; if sparse-checked-out, read via `git show origin/main:.repos/<path>`).

### Internal docs by area

Read the matching doc before changing code in that area; code review enforces them.

| Area                                       | Read first                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & orchestration               | [00_glossary.md](docs/internals/00_glossary.md), [01_architecture.md](docs/internals/01_architecture.md)                                                                                          |
| Server Effect services & errors            | [02_effect-services.md](docs/internals/02_effect-services.md)                                                                                                                                     |
| Providers & ACP                            | [03_providers.md](docs/internals/03_providers.md)                                                                                                                                                 |
| Auth, MCP, guest links, assets, security   | [04_environment-auth.md](docs/internals/04_environment-auth.md), [SECURITY.md](SECURITY.md)                                                                                                       |
| Remote routes, peer links, previews        | [05_remote.md](docs/internals/05_remote.md)                                                                                                                                                       |
| T3 Connect & relay                         | [06_t3-connect.md](docs/internals/06_t3-connect.md)                                                                                                                                               |
| Server updates & crash recovery            | [07_server-updates.md](docs/internals/07_server-updates.md)                                                                                                                                       |
| Telemetry & analytics                      | [08_product-analytics.md](docs/internals/08_product-analytics.md)                                                                                                                                 |
| Client connection & sync runtime           | [09_connection-runtime.md](docs/internals/09_connection-runtime.md)                                                                                                                               |
| Web UI primitives, styles & React Compiler | [10_web-ui.md](docs/internals/10_web-ui.md)                                                                                                                                                       |
| Mobile layout, navigation & dev lifecycle  | [11_mobile-layout.md](docs/internals/11_mobile-layout.md), [12_mobile-navigation.md](docs/internals/12_mobile-navigation.md), [13_mobile-development.md](docs/internals/13_mobile-development.md) |
| Translations & UI copy                     | [14_i18n.md](docs/internals/14_i18n.md)                                                                                                                                                           |
| Writing & reviewing tests                  | [15_testing.md](docs/internals/15_testing.md)                                                                                                                                                     |
| Wire budgets, server metrics & perf        | [16_performance-regressions.md](docs/internals/16_performance-regressions.md)                                                                                                                     |
| Repo & package scripts                     | [17_scripts.md](docs/internals/17_scripts.md)                                                                                                                                                     |

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`, declare protected methods in `CLIENT_GUARDED_RPC_SCOPES`, and gate UI with `permissionAtom` (server stays authoritative). Keep raw RPC clients inside `rpc/`.
- Server features are Effect services using `Effect.fn("Service.operation")` with thin transport handlers; see [02_effect-services.md](docs/internals/02_effect-services.md).
- `apps/web/src/components/ui` exports own their look (`shadcn/no-restyle` enforces this); see [10_web-ui.md](docs/internals/10_web-ui.md).
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, external quirk, or invariant the code can't show (1–4 lines max; `t3code/no-low-value-comments` enforces this).
- React effects are only for synchronizing with external systems. Derive in render and act in handlers; any remaining effect states its reason via `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- No continuously repainting animations; they peg the GPU on high-refresh displays.
- Security matters, but do not over-index on dev-mode or maintainer-only features. Read [SECURITY.md](SECURITY.md) before auditing or triaging reports.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

---

## Fork & Patch Maintenance Playbook (`michaelik1/t3code-tuned`)

This repository is a personal fork of `pingdotgg/t3code` (migrated from `michaelik1/t3code-enhancement-patches`). Upstream `AGENTS.md` above remains the authoritative project map, architecture guide, and safety/style reference; this section documents the fork-specific branch model, release pipeline, and maintenance rules.

### 1. Remotes & Branch Topology

- **Remotes:**
  - `origin`: `git@github.com:michaelik1/t3code-tuned.git` (this fork)
  - `upstream`: `https://github.com/pingdotgg/t3code.git` (official T3 Code)
- **Base branch (`main`):**
  - Tracks official upstream **stable** release tags (currently `v0.1.11`, commit `59651c1761`) plus a single fork commit appending this playbook to `AGENTS.md`.
  - Updated only when a new upstream stable release tag ships (e.g. `v0.1.12`).
- **Upstream PR mirror branches (`upstream-pr/*`):**
  - `upstream-pr/tools-and-skills`: mirrors `upstream/t3code/skills-installer` (PR `pingdotgg/t3code#17691`) untouched, so new maintainer commits can be fetched and integrated into `patch/tools-and-skills`.
- **Patch branches (`patch/*`, all branched off `main`):**
  - **Naming convention:**
    - `patch/<name>` — feature/behavior patches that change the shipped application code.
    - `patch/dev-<name>` — development, CI, tooling, or release-infrastructure branches that do not change application runtime code (e.g. `patch/dev-custom-ci`).
  1. `patch/custom-updater` — `<upstream>-patch.<major>.<minor>` semver ordering, `ElectronUpdater` patch-aware update checks, and forced `latest*.yml` updater manifest emission.
  2. `patch/usage-limits` — built-in `t3_usage_limits` MCP tool that refreshes and returns provider & hub usage quotas with native T3 presentation.
  3. `patch/voice-recording-limit` — extends local voice dictation limit from 5 minutes to 1 hour while keeping cloud providers at 5 minutes, and shows the active limit in Voice settings.
  4. `patch/disable-telemetry` — permanently disables all external/phone-home telemetry (PostHog / `ingest.t3.codes` analytics, owner/provider ID harvesting, and T3 Connect Axiom OTLP relay tracing).
  5. `patch/codex-shadow-home` — replaces stale local `*.sqlite` / `-wal` / `-shm` / `-journal` runtime files in Codex shadow homes with shared symlinks (and defers gracefully on Windows file locks) so multi-account Codex instances stop failing on startup.
  6. `patch/tools-and-skills` — adapted port of upstream PR `#17691` (global & project MCP servers, Skill Library, Composer Tool Presets, `t3_tools_*`/`t3_skills_*` MCP tools, UI localization, and bundler/Effect adaptations).
  7. `patch/dev-custom-ci` — `patch-release.json`, `knip.jsonc` adjustments, and desktop-only GitHub Actions release pipeline (`.github/workflows/release.yml` + `release-desktop.yml`) targeting macOS (`arm64`, `x64`), Windows (`x64`, `arm64` + WSL runtime), and Linux (`x64`, `arm64`). Mobile builds are intentionally excluded.
- **Integration / release branch (`release`):**
  - Merge of all `patch/*` branches plus the combined `apps/server/src/provider/agentContextBudget.json` update.
  - Release builds are triggered from `release` via GitHub Actions `workflow_dispatch`.

### 2. Per-Branch `AGENTS.md` Rule

Every `patch/*` branch appends a concise `### Branch Notes: patch/<name>` subsection at the bottom of `AGENTS.md` summarizing what that branch changes, which files it touches, and any rebase/integration traps. When merging into `release`, keep the main playbook plus a combined summary of the merged branches.

### 3. Versioning, Release Notes & Build Scope

- **Version format:** `v<upstream>-patch.<major>.<minor>` (e.g. `v0.1.11-patch.3.0`), configured in `patch-release.json` on `patch/dev-custom-ci` (`upstream_tag` + `patch_version`).
  - Keep `patch_version` monotonic across feature generations (do not reset it to `1.0` on an upstream bump).
- **Release title:** Same as the release tag — `v<upstream>-patch.<major>.<minor>` (e.g. `v0.1.13-patch.2.0`), with no `Patched T3 Code` prefix.
- **Release notes file:** `RELEASE_NOTES.md` on `patch/dev-custom-ci` (uses `{{UPSTREAM_TAG}}` placeholder; `release.yml` reads it automatically so the workflow never needs manual edits for release copy).
- **Release notes template (English):**
  ```markdown
  ## Based on upstream stable [{{UPSTREAM_TAG}}](https://github.com/pingdotgg/t3code/releases/tag/{{UPSTREAM_TAG}})

  ### Included patches

  - **<Human-readable patch name>** — <short, user-friendly description>.

  ### Changes

  - <Concrete fixes, patch updates, newly added patches, or CI/release changes in this release — omit section if none>

  ### Downloads

  Builds are unsigned.
  ```
  - `### Included patches` is a concise, user-friendly overview ("booklet") of the product patches (`patch/<name>`) shipped in the fork — use human-readable names (no raw branch names) and avoid low-level implementation details. Keep this list stable across releases; only add/remove/edit entries when the set of shipped patches or a patch's user-facing scope changes.
  - `### Changes` lists what specifically changed in the current release (bug fixes, patch updates, newly added patches, and CI/release changes) with slightly more detail. When adding a new patch, add its short summary to `### Included patches` and mention the addition in `### Changes`. Omit `### Changes` if there are no release-specific changes.
  - Keep `### Downloads` minimal with only `Builds are unsigned.` (GitHub Releases already lists the build assets).
- **Platforms built:** Desktop only — macOS (`arm64`, `x64`), Windows (`x64`, `arm64` with embedded Linux WSL runtimes), and Linux (`x64`, `arm64` AppImage/deb + CLI archives). Mobile (iOS/Android), npm CLI publish, AUR, and relay deploys are not built or published in this fork.

### 4. Updating to a New Upstream Stable Release (e.g. `v0.1.12`)

1. **Fetch upstream tag and rebase `main`:**
   ```powershell
   git fetch upstream --tags
   git checkout main
   git rebase v0.1.12
   git push origin main --force-with-lease
   ```
2. **Rebase each `patch/*` branch onto the new `main`:**
   ```powershell
   foreach ($b in @("patch/custom-updater", "patch/usage-limits", "patch/voice-recording-limit", "patch/disable-telemetry", "patch/codex-shadow-home", "patch/tools-and-skills", "patch/dev-custom-ci")) {
     git checkout $b
     git rebase main
     git push origin $b --force-with-lease
   }
   ```
   - On `patch/dev-custom-ci`, update `upstream_tag` (and `patch_version` if needed) in `patch-release.json` and update `RELEASE_NOTES.md`.
3. **Pull updates from maintainer PRs (if any):**
   ```powershell
   git fetch upstream t3code/skills-installer:refs/remotes/upstream/t3code/skills-installer
   git branch -f upstream-pr/tools-and-skills upstream/t3code/skills-installer
   git push origin upstream-pr/tools-and-skills --force-with-lease
   # Inspect new commits and cherry-pick or merge into patch/tools-and-skills, resolving conflicts there.
   ```
4. **Rebuild `release`:**
   ```powershell
   git checkout -B release main
   git merge patch/custom-updater patch/usage-limits patch/voice-recording-limit patch/disable-telemetry patch/codex-shadow-home patch/tools-and-skills patch/dev-custom-ci -m "Merge patch/* branches into release (v0.1.12-patch.X.Y)"
   ```
   - Resolve `AGENTS.md` (and `packages/client-runtime/src/t3ToolSummary.ts` if both `usage-limits` and `tools-and-skills` touch it).
   - Update `mcpToolListJsonBytes` in `apps/server/src/provider/agentContextBudget.json` if `AgentContextBudget.test.ts` reports a new byte count.
5. **Verify locally and publish:**
   ```powershell
   vp test run packages/shared/src/semver.test.ts apps/server/src/mcp/toolkits/orchestrator/usageLimitsPatch.test.ts apps/server/src/provider/AgentContextBudget.test.ts apps/server/src/speech/SpeechService.test.ts apps/server/src/skills/SkillLibrary.test.ts apps/server/src/mcpServers/McpServerTools.test.ts
   vp run --filter t3 typecheck
   git push origin release --force-with-lease
   gh workflow run release.yml --ref release -R michaelik1/t3code-tuned
   ```

### 5. Key Technical Gotchas

- **Effect `4.1.2+` Crypto / Digest API:** Upstream replaced `effect/Crypto` with `effect/crypto/Digest` and `effect/crypto/SecureRandom`. Keep `SkillLibrary.ts` / tests using `Digest.Digest` and `NodeCrypto.layer`.
- **Linux/WSL single-executable (`build-exe`) bundler check:** `apps/server/src/mcpServers/McpServerTools.ts` dynamically imports `@modelcontextprotocol/sdk` via `loadSdkModule()` so `cli.ts build-exe` does not fail with `ServerCliExecutableImportError` on bare `zod/v3`/`zod/v4` imports.
- **MCP Tool List Context Budget:** Combining `t3_usage_limits` (`patch/usage-limits`) with `t3_tools_*` and `t3_skills_*` (`patch/tools-and-skills`) increases `mcpToolListJsonBytes` in `apps/server/src/provider/agentContextBudget.json`. Always verify with `AgentContextBudget.test.ts` on `release`.
- **Knip unused-entry checks:** Because `patch/dev-custom-ci` removes unused upstream workflows, keep `.github/scripts/mirror-play-apk.cjs`, `resolve-nightly-release.ts`, and `apps/web/scripts/verify-built-boot.ts` listed in `knip.jsonc`.

### Branch Notes: `patch/dev-custom-ci`

- **Purpose:** Configures fork release metadata (`patch-release.json`) and desktop-only GitHub Actions release builds for `michaelik1/t3code-tuned` using version format `v<upstream>-patch.<major>.<minor>`.
- **Key changes:**
  - `patch-release.json` & `RELEASE_NOTES.md`: store release version (`upstream_tag` + `patch_version`) and release notes template (`{{UPSTREAM_TAG}}` placeholder).
  - `.github/workflows/release.yml`: `workflow_dispatch` pipeline that runs focused patch tests, builds the JS bundle once, invokes `.github/workflows/release-desktop.yml` across all 6 desktop targets on standard GitHub-hosted runners (macOS arm64/x64, Linux x64/arm64, Windows x64/arm64 + embedded WSL runtimes), merges multi-arch updater manifests (`latest.yml`, `latest-mac.yml`), and publishes `v<upstream>-patch.<major>.<minor>`.
  - `.github/workflows/release-desktop.yml`: makes Clerk/relay inputs optional (`default: ""`) so fork builds succeed without upstream secrets.
  - Removes unused upstream workflows (mobile, AUR, relay, PR triage, nightly schedule) and adds the 3 orphaned script entries to `knip.jsonc`.
- **Rebase notes:** When updating to a new upstream release, bump `upstream_tag` in `patch-release.json` (keep `patch_version` monotonic) and re-check `.github/workflows/release-desktop.yml` for any newly added required inputs.

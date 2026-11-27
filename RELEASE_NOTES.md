## Based on upstream stable [{{UPSTREAM_TAG}}](https://github.com/pingdotgg/t3code/releases/tag/{{UPSTREAM_TAG}})

### Included patches

- **Custom Updater** — patch versioning, auto-updates, and CLI/SSH installs from `michaelik1/t3code-tuned`.
- **Usage Limits MCP Tool** — adds `t3_usage_limits` method to built-in T3 MCP with live provider/hub quota refresh.
- **1-Hour Local Voice Dictation** — raises local voice recording limit from 5 minutes to 1 hour (cloud providers remain at 5 minutes).
- **Telemetry Disabled** — permanently disables PostHog (`ingest.t3.codes`) analytics, owner/provider ID harvesting, and T3 Connect Axiom relay tracing.
- **Codex Shadow Home Fix** — prevents startup failures and config desync on Windows when using multiple Codex accounts.
- **Tools & Skills** — Settings → Tools (MCP servers, Skill Library) and Composer Tool Presets (port of upstream PR #17691).

### Changes

- Rebased all patches onto upstream stable `v0.1.13` (includes all changes from `v0.1.12` and `v0.1.13`).
- Updated telemetry opt-out patch for upstream's new `DO_NOT_TRACK`, `allowedFor`, and `AnalyticsService.record` changes.

### Downloads

Builds are unsigned.

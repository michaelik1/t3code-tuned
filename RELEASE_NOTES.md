## Based on upstream stable [{{UPSTREAM_TAG}}](https://github.com/pingdotgg/t3code/releases/tag/{{UPSTREAM_TAG}})

### Included patches

- **Custom Updater** — supports `<upstream>-patch.<major>.<minor>` versioning, auto-updates, CLI/SSH archive downloads, and install scripts from `michaelik1/t3code-tuned`.
- **Usage Limits MCP Tool** — adds `t3_usage_limits` with live provider/hub quota refresh and native UI presentation.
- **1-Hour Local Voice Dictation** — raises local voice recording limit from 5 minutes to 1 hour (cloud providers remain at 5 minutes) and shows the active limit in Voice settings.
- **Telemetry Disabled** — permanently disables PostHog (`ingest.t3.codes`) analytics, owner/provider ID harvesting, and T3 Connect Axiom relay tracing.
- **Codex Shadow Home Fix** — automatically replaces stale local SQLite database and WAL/SHM/journal files in Codex shadow homes with shared symlinks so multi-account Codex instances start reliably on Windows: also replaces atomically rewritten `config.toml`, `version.json`, and `project-metadata-locks` entries and defers gracefully when locked.
- **Tools & Skills** — Settings → Tools (MCP servers, Skill Library) and Composer Tool Presets (port of upstream PR #17691) with UI localization and `build-exe` bundling fixes.

### Other changes

- Switched `RELEASE_NOTES.md` placeholder from `__UPSTREAM_TAG__` to `{{UPSTREAM_TAG}}` so Markdown formatting does not mangle the link text.
- Desktop-only GitHub Actions release pipeline for macOS, Windows (+ WSL runtime), and Linux (`x64` & `arm64`); mobile builds excluded.

### Downloads

Desktop builds for macOS (`arm64`, `x64`), Windows (`x64`, `arm64` with embedded WSL runtime), and Linux (`x64`, `arm64` AppImage & `.deb`), plus standalone CLI archives (`SHA256SUMS`). Builds are unsigned.

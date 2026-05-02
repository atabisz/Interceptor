# interceptor

> Canonical agent instructions live in [AGENTS.md](AGENTS.md). User-facing overview lives in [README.md](README.md). This file is retained as a compatibility shim for tools that still look for `CLAUDE.md`.

Browser control CLI for AI agents. No CDP, no MCP, no API keys. You call `interceptor`, read the output, decide what's next.

**Binary:** `dist/interceptor`

## Two Surfaces

Interceptor ships one CLI binary with two product surfaces under one daemon:

- **Interceptor Browser** (`interceptor open / read / act / inspect / scene / monitor / net / sse / override / screenshot / …`) — drives a real Chrome / Brave session inside your existing profile. Skill: `.agents/skills/interceptor-browser/`.
- **Interceptor macOS** (`interceptor macos *`) — drives native macOS apps via a Swift bridge daemon. Skill: `.agents/skills/interceptor-macos/`.

Pick by where the target lives. Page content → Browser. Anything outside the page → macOS. The full decision matrix is in [AGENTS.md → Browser Extension vs macOS Bridge](AGENTS.md#browser-extension-vs-macos-bridge).

## Two Install Modes

The CLI surface is the same binary, but the install can be either of two modes. Check which one you're on with `interceptor status` (the `mode:` line).

| Mode | What's installed | Available commands | macOS TCC consents |
|---|---|---|---|
| `browser-only` | CLI + daemon + extension | All browser commands (`open / read / act / inspect / scene / net / monitor / screenshot / eval / canvas`). `interceptor macos *` returns a structured "requires full computer-use install" error in <1s. | None |
| `full` | Everything in browser-only **plus** the Swift bridge `.app` + LaunchAgent | Browser commands **plus** `interceptor macos *` (AX tree, OS input, ScreenCaptureKit, Vision/Speech/NLP). | Screen Recording, Accessibility, Apple Events (per-app on first dispatch) |

The mode is set by the install channel:
- **End users**: `Interceptor-Browser-<v>.pkg` → `mode: browser-only`. `Interceptor-Full-<v>.pkg` → `mode: full`.
- **Developers building from source**: `scripts/install.sh --browser-only` → `mode: browser-only`. `scripts/install.sh --full` → `mode: full`.
- **Promotion**: `interceptor upgrade --full` works for both pkg-installed and dev-installed browser-only.

Decision rule for agents:
- If `interceptor status` reports `mode: browser-only` and the user asks for something native (a screenshot of an occluded app, a click in Finder), respond with: "I'm on a browser-only install — run `interceptor upgrade --full` to enable that command." Do not retry; do not loop on the timeout.
- If `interceptor status` reports `mode: full`, native commands are fair game.
- `interceptor upgrade --full` is the documented promotion path. macOS only.

## Start Here

`.agents/skills/interceptor-windows/` is reserved for a future Windows surface (UIA / Win32 / ETW). It is not built.

```bash
# Browser (works in both modes)
interceptor open "https://example.com"        # Open, wait, return tree + text
interceptor act e1                             # Click element, return updated tree + diff
interceptor inspect                            # Tree + text + network log + headers

# macOS (full mode only)
interceptor macos open "Finder"                # Activate + tree + windows
interceptor macos act e5                       # Click + wait + updated tree
```

The daemon auto-starts on first command. When working inside this repo, prefer `./dist/interceptor ...` if `interceptor` is not on `PATH`.

## Where The Detail Lives

| You want to | Read |
|---|---|
| User-facing install / overview / per-surface command index / recipes | [README.md](README.md) |
| Agent operating manual: rules, decision tables, workflows, escape hatches | [AGENTS.md](AGENTS.md) |
| Architecture (transport, monitor, scene, screenshots) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Browser-surface fast path for skill loaders | [.agents/skills/interceptor-browser/SKILL.md](.agents/skills/interceptor-browser/SKILL.md) |
| macOS-surface fast path for skill loaders | [.agents/skills/interceptor-macos/SKILL.md](.agents/skills/interceptor-macos/SKILL.md) |
| Native bridge domain index | [docs/native/README.md](docs/native/README.md) |

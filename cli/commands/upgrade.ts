/**
 * cli/commands/upgrade.ts — interceptor upgrade --full
 *
 * Promote a browser-only install to full computer-use mode by chaining
 * into scripts/install-bridge.sh.
 *
 * Resolution order for the install-bridge.sh path:
 *   1. INTERCEPTOR_REPO env var (developer-friendly override)
 *   2. /Library/Application Support/Interceptor/scripts/install-bridge.sh (pkg install)
 *   3. Walk up from the CLI binary path looking for scripts/install-bridge.sh
 *   4. Bail with a structured error pointing the user at the manual command.
 *
 * Returns null after handling output — wired into cli/index.ts the same way
 * meta status / events are.
 */

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const BRIDGE_INSTALL_RELATIVE = "scripts/install-bridge.sh"
const PKG_INSTALL_DIR = "/Library/Application Support/Interceptor"

function resolveInstallBridgeScript(): string | null {
  // 1. Env override
  const envRoot = process.env.INTERCEPTOR_REPO
  if (envRoot) {
    const candidate = resolve(envRoot, BRIDGE_INSTALL_RELATIVE)
    if (existsSync(candidate)) return candidate
  }

  // 2. Public pkg install location
  const pkgCandidate = resolve(PKG_INSTALL_DIR, BRIDGE_INSTALL_RELATIVE)
  if (existsSync(pkgCandidate)) return pkgCandidate

  // 3. Walk up from process.execPath / process.argv[0] / cwd looking for the
  //    scripts/ dir. With bun --compile, process.execPath is the standalone
  //    binary in dist/, so walking up two directories typically lands us at
  //    the repo root.
  const candidates = [
    process.execPath ? dirname(process.execPath) : null,
    process.argv[0] ? dirname(process.argv[0]) : null,
    process.cwd(),
  ].filter((p): p is string => typeof p === "string" && p.length > 0)

  for (const start of candidates) {
    let cur = start
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(cur, BRIDGE_INSTALL_RELATIVE)
      if (existsSync(candidate)) return candidate
      const parent = dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  }

  return null
}

export async function runUpgradeCommand(filtered: string[]): Promise<null> {
  // Subcommand shape: `interceptor upgrade --full`
  // We accept --full as a flag (positional or otherwise). Future modes can
  // be added here.
  const wantsFull = filtered.includes("--full")
  if (!wantsFull) {
    console.error("usage: interceptor upgrade --full")
    console.error("  Promote a browser-only install to full computer-use mode (macOS only).")
    process.exit(1)
  }

  if (process.platform !== "darwin") {
    console.error("error: 'interceptor upgrade --full' is macOS only.")
    console.error("  The Swift bridge that backs full mode requires macOS.")
    process.exit(1)
  }

  const script = resolveInstallBridgeScript()
  if (!script) {
    console.error("error: could not locate scripts/install-bridge.sh.")
    console.error("  Tried:")
    console.error("    • $INTERCEPTOR_REPO/scripts/install-bridge.sh")
    console.error(`    • ${PKG_INSTALL_DIR}/scripts/install-bridge.sh`)
    console.error("    • ancestors of the CLI binary up to 6 levels")
    console.error("")
    console.error("  Set INTERCEPTOR_REPO to the repo root, then re-run:")
    console.error("    INTERCEPTOR_REPO=/path/to/Interceptor interceptor upgrade --full")
    console.error("")
    console.error("  Or run the script directly:")
    console.error("    bash /path/to/Interceptor/scripts/install-bridge.sh")
    process.exit(1)
  }

  console.log(`==> Upgrading to full computer-use mode via ${script} ...`)
  console.log("")

  const result = spawnSync("bash", [script], { stdio: "inherit" })
  if (result.status !== 0) {
    console.error("")
    console.error(`error: install-bridge.sh exited with status ${result.status}`)
    process.exit(result.status ?? 1)
  }

  console.log("")
  console.log("==> Upgrade complete. Run 'interceptor status' — expect 'mode: full'.")
  console.log("    First 'interceptor macos screenshot' will trigger the Screen Recording prompt.")
  console.log("    First 'interceptor macos act' will trigger the Accessibility prompt.")
  return null
}

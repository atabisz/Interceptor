import { describe, expect, test } from "bun:test"
import { pickTimeoutForAction, INTERCEPTOR_TIMEOUT_MS } from "../cli/transport"

// pickTimeoutForAction chooses the CLI-side transport timeout per action.
// The default DOM-render screenshot gets 35s (SW guards at 30s); the --pixel
// path has no SW cap and can legitimately run long (strip-by-strip capture),
// so it must get a ceiling aligned with the daemon's request timeout rather
// than being cut at 35s.

describe("pickTimeoutForAction", () => {
  test("default screenshot (DOM-render) uses the 35s ceiling", () => {
    expect(pickTimeoutForAction({ type: "screenshot" })).toBe(35_000)
    expect(pickTimeoutForAction({ type: "screenshot", pixel: false })).toBe(35_000)
  })

  test("--pixel screenshot gets a long ceiling, not the 35s DOM-render cap", () => {
    const t = pickTimeoutForAction({ type: "screenshot", pixel: true })
    expect(t).toBeGreaterThan(35_000)
    // Must stay under the daemon's 180s request timeout so the CLI doesn't
    // outlive the daemon's own response.
    expect(t).toBeLessThan(180_000)
  })

  test("--pixel --full also gets the long ceiling", () => {
    expect(pickTimeoutForAction({ type: "screenshot", pixel: true, full: true })).toBeGreaterThan(35_000)
  })

  test("macos overrides unchanged", () => {
    expect(pickTimeoutForAction({ type: "macos_listen" })).toBe(60_000)
    expect(pickTimeoutForAction({ type: "macos_vad" })).toBe(60_000)
  })

  test("unlisted actions fall back to the default timeout", () => {
    expect(pickTimeoutForAction({ type: "tab_list" })).toBe(INTERCEPTOR_TIMEOUT_MS)
  })
})

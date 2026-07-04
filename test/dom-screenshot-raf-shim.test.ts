/// <reference lib="dom" />

import { describe, expect, test, mock, beforeEach } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

try { GlobalRegistrator.register() } catch { /* already registered by an earlier test file */ }

// The DOM-render screenshot path shims globalThis.requestAnimationFrame onto
// setTimeout while html-to-image runs, because rAF is frozen on backgrounded
// tabs and html-to-image resolves its rasterized image inside an rAF callback.
// These tests lock in that behaviour — the fix silently reverts to an infinite
// hang if a future html-to-image bump captures rAF at module-eval time or
// switches to `window.requestAnimationFrame`, so the "bare call is intercepted"
// assertion is the load-bearing regression guard.

// A stand-in for html-to-image installed on globalThis, which is what
// dom-screenshot.ts's getLibrary() reads (__interceptor_h2i). Each test swaps
// its toPng/toJpeg implementation to observe rAF state mid-render.
type Lib = {
  toPng: (node: HTMLElement, opts?: Record<string, unknown>) => Promise<string>
  toJpeg: (node: HTMLElement, opts?: Record<string, unknown>) => Promise<string>
}
function installLib(lib: Lib) {
  ;(globalThis as unknown as { __interceptor_h2i?: Lib }).__interceptor_h2i = lib
}

const PNG = "data:image/png;base64,AAAA"

// Inferred from the real module so the test's call signature can't drift from
// handleDomScreenshot's actual parameter type (DomScreenshotAction).
let handleDomScreenshot: typeof import("../extension/src/content/dom-screenshot").handleDomScreenshot

beforeEach(async () => {
  // Fresh import per test so module state (the withRafShim refcount) can't leak
  // across tests. Bun caches modules, so re-import returns the same instance —
  // that's fine here because every test restores rAF to native by construction.
  ;({ handleDomScreenshot } = await import("../extension/src/content/dom-screenshot"))
})

describe("dom-screenshot rAF shim", () => {
  test("shim is active DURING the render and the library's bare rAF resolves", async () => {
    const native = globalThis.requestAnimationFrame
    let shimSeen: ((cb: FrameRequestCallback) => number) | null = null
    let bareRafFired = false

    installLib({
      toJpeg: async () => PNG,
      toPng: async () => {
        // Capture the global as html-to-image would see it mid-render.
        shimSeen = globalThis.requestAnimationFrame
        // Exactly how html-to-image/es/util.js calls it: a BARE reference,
        // not window.requestAnimationFrame. Must resolve promptly via the shim.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => { bareRafFired = true; resolve() })
        })
        return PNG
      },
    })

    const res = await handleDomScreenshot({ type: "dom_screenshot", mode: "full", format: "png" })
    expect(res.success).toBe(true)
    // Mid-render the global was NOT the native rAF (it was the setTimeout shim).
    expect(shimSeen).not.toBe(native)
    expect(bareRafFired).toBe(true)
  })

  test("restores native rAF after a successful render", async () => {
    const native = globalThis.requestAnimationFrame
    installLib({ toJpeg: async () => PNG, toPng: async () => PNG })
    await handleDomScreenshot({ type: "dom_screenshot", mode: "full", format: "png" })
    expect(globalThis.requestAnimationFrame).toBe(native)
  })

  test("restores native rAF even when the render throws", async () => {
    const native = globalThis.requestAnimationFrame
    installLib({
      toJpeg: async () => PNG,
      toPng: async () => { throw new Error("boom render") },
    })
    const res = await handleDomScreenshot({ type: "dom_screenshot", mode: "full", format: "png" })
    expect(res.success).toBe(false)
    expect(globalThis.requestAnimationFrame).toBe(native)
  })

  test("reentrancy-safe: overlapping renders both restore to native (either finish order)", async () => {
    const native = globalThis.requestAnimationFrame
    // Two renders whose completion we control, started concurrently on the same
    // module (same frame). The naive save/restore would leave the shim installed
    // permanently; the refcount must restore native only when the last finishes.
    let resolveA: (v: string) => void
    let resolveB: (v: string) => void
    const aDone = new Promise<string>((r) => { resolveA = r })
    const bDone = new Promise<string>((r) => { resolveB = r })

    installLib({ toJpeg: async () => PNG, toPng: () => aDone })
    const pA = handleDomScreenshot({ type: "dom_screenshot", mode: "full", format: "png" })
    installLib({ toJpeg: async () => PNG, toPng: () => bDone })
    const pB = handleDomScreenshot({ type: "dom_screenshot", mode: "full", format: "png" })

    // While both are in flight, the global is the shim, not native.
    expect(globalThis.requestAnimationFrame).not.toBe(native)

    // Finish A first, then B — the LAST finisher must restore native.
    resolveA!(PNG)
    await pA
    resolveB!(PNG)
    await pB

    expect(globalThis.requestAnimationFrame).toBe(native)
  })
})

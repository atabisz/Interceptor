import { describe, expect, test } from "bun:test"
import { planPixelFallback } from "../extension/src/background/capabilities/screenshot"

// planPixelFallback decides whether a failed DOM-render screenshot retries via
// the pixel path, and shapes that request. These tests lock in the gating +
// request-shaping fixes from the code review:
//  #1 full-page must be preserved (pixel fallback sets full:true)
//  #2 element/ref must NOT fall back (pixel can't honor them)
//  #4 only a genuine render failure (fallbackEligible) falls back
//  #5 --scale is dropped and named in the note

const RENDER_FAIL = { success: false, error: "dom render failed: image load failed", fallbackEligible: true }

describe("planPixelFallback", () => {
  test("#4: only falls back on a genuine render failure (fallbackEligible)", () => {
    // An actionable error (tab not found / restricted) is NOT eligible.
    const notEligible = { success: false, error: "tab 5 not found" }
    expect(planPixelFallback({ type: "screenshot" }, notEligible)).toBeNull()
    // Eligible render failure → plan produced.
    expect(planPixelFallback({ type: "screenshot" }, RENDER_FAIL)).not.toBeNull()
  })

  test("#1: whole-page fallback reconstructs an explicit FULL-page pixel request", () => {
    const plan = planPixelFallback({ type: "screenshot" }, RENDER_FAIL)
    expect(plan).not.toBeNull()
    expect(plan!.pixelAction).toMatchObject({ type: "screenshot", pixel: true, full: true })
  })

  test("#2: element/ref/region/clip/selector captures do NOT fall back", () => {
    for (const scoped of [
      { type: "screenshot", ref: "e5" },
      { type: "screenshot", element: 3 },
      { type: "screenshot", region: { x: 0, y: 0, width: 10, height: 10 } },
      { type: "screenshot", clip: { x: 0, y: 0, width: 10, height: 10 } },
      { type: "screenshot", selector: ".foo" },
    ]) {
      expect(planPixelFallback(scoped, RENDER_FAIL)).toBeNull()
    }
  })

  test("#5: --scale is dropped and named in the fallback note", () => {
    const plan = planPixelFallback({ type: "screenshot", scale: 2 }, RENDER_FAIL)
    expect(plan).not.toBeNull()
    expect(plan!.pixelAction.scale).toBeUndefined() // pixel path can't honor it
    expect(plan!.note).toContain("dropped: --scale")
  })

  test("pixel-honored options are carried through; note has no 'dropped' when none dropped", () => {
    const plan = planPixelFallback(
      { type: "screenshot", format: "jpeg", quality: 80, target_max_long_edge: 1568, save: true },
      RENDER_FAIL
    )
    expect(plan).not.toBeNull()
    expect(plan!.pixelAction).toMatchObject({
      pixel: true, full: true, format: "jpeg", quality: 80, target_max_long_edge: 1568, save: true,
    })
    expect(plan!.note).not.toContain("dropped")
    expect(plan!.note).toContain("→ pixel")
  })

  test("the DOM-render error is preserved in the note (reason isn't lost)", () => {
    const plan = planPixelFallback({ type: "screenshot" }, RENDER_FAIL)
    expect(plan!.note).toContain("image load failed")
  })
})

/// <reference lib="dom" />

import { describe, expect, test, mock } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

try { GlobalRegistrator.register() } catch { /* already registered */ }

// happy-dom doesn't compute layout, so isVisible() needs a stub that uses
// connectedness + explicit hidden styles only.
mock.module("../extension/src/content/element-discovery", () => ({
  isVisible: (el: Element) => {
    if (!el.isConnected) return false
    let cur: Element | null = el
    while (cur) {
      const style = (cur as HTMLElement).style
      if (style?.display === "none" || style?.visibility === "hidden") return false
      cur = cur.parentElement
    }
    return true
  },
  isInteractive: (el: Element, _tags: Set<string>, _roles: Set<string>) => {
    const tag = el.tagName
    return tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
  },
  INTERACTIVE_TAGS: new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]),
  INTERACTIVE_ROLES: new Set(["button", "link", "textbox", "checkbox"]),
}))

import { buildA11yTree } from "../extension/src/content/a11y-tree"

function makeRoot(html: string): Element {
  document.body.innerHTML = html
  return document.body
}

describe("buildA11yTree --tree-format", () => {
  test("default (no format arg) === explicit verbose — bit-identical", () => {
    const root = makeRoot(`<nav><button>Submit</button><input type="email" /></nav>`)
    const defaultOut = buildA11yTree(root, 0, 10, "interactive")
    const verboseOut = buildA11yTree(root, 0, 10, "interactive", false, "verbose")
    expect(defaultOut).toBe(verboseOut)
  })

  test("compact preserves the same set of refs as verbose", () => {
    const root = makeRoot(`
      <nav><a href="/x">Link X</a><a href="/y">Link Y</a></nav>
      <main><button type="submit">Send</button><input type="text" name="q" /></main>
      <footer><button>Help</button></footer>
    `)
    const verbose = buildA11yTree(root, 0, 10, "interactive", false, "verbose")
    const compact = buildA11yTree(root, 0, 10, "interactive", false, "compact")

    const refsOf = (s: string) => [...s.matchAll(/\[(e\d+)/g)].map((m: RegExpMatchArray) => m[1]).sort()
    expect(refsOf(compact)).toEqual(refsOf(verbose))
    expect(refsOf(compact).length).toBeGreaterThan(0)
  })

  test("compact is smaller than verbose on a multi-element tree", () => {
    const root = makeRoot(`
      <nav>
        <a href="/x">Link X</a><a href="/y">Link Y</a><a href="/z">Link Z</a>
      </nav>
      <main>
        <button type="submit">Send Message</button>
        <input type="email" name="email" placeholder="Your email" />
        <input type="text" name="subject" placeholder="Subject" />
        <textarea name="body" placeholder="Message body"></textarea>
      </main>
      <footer><button>Help</button><button>About</button></footer>
    `)
    const verbose = buildA11yTree(root, 0, 10, "interactive", false, "verbose")
    const compact = buildA11yTree(root, 0, 10, "interactive", false, "compact")

    expect(compact.length).toBeLessThan(verbose.length)
  })

  test("compact uses '>' depth prefix and pipe-separated brackets", () => {
    const root = makeRoot(`<nav><button>Click</button></nav>`)
    const compact = buildA11yTree(root, 0, 10, "interactive", false, "compact")
    // At least one line uses '>' as depth prefix (the button is nested under nav)
    expect(compact).toMatch(/>\[e\d+\|button\|Click\]/)
  })

  test("verbose uses bracketed-then-spaced format (unchanged)", () => {
    const root = makeRoot(`<nav><button>Click</button></nav>`)
    const verbose = buildA11yTree(root, 0, 10, "interactive", false, "verbose")
    // Verbose has [refId] followed by space and role/name with quotes
    expect(verbose).toMatch(/\[e\d+\] button "Click"/)
  })
})

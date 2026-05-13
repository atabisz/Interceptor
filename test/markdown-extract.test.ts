/// <reference lib="dom" />
import { describe, expect, test, mock } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"

try { GlobalRegistrator.register() } catch { /* already registered */ }

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
}))

import { renderMarkdown } from "../extension/src/content/data/markdown-extract"

function root(html: string): Element {
  document.body.innerHTML = html
  return document.body
}

describe("renderMarkdown", () => {
  test("S1 fixture pattern — bold + plain prose are visually distinct", () => {
    const md = renderMarkdown(root(`
      <div>
        <h2>Cedar</h2>
        <div class="section"><strong>Cedar summary: nested panel benchmark target</strong></div>
        <div class="section">Summary tab for Cedar. Use this for the exact summary extract.</div>
      </div>
    `))
    expect(md).toContain("## Cedar")
    expect(md).toContain("**Cedar summary: nested panel benchmark target**")
    expect(md).toContain("Summary tab for Cedar. Use this for the exact summary extract.")
    const boldIdx = md.indexOf("**Cedar summary")
    const plainIdx = md.indexOf("Summary tab for Cedar")
    expect(boldIdx).toBeGreaterThanOrEqual(0)
    expect(plainIdx).toBeGreaterThan(boldIdx)
  })

  test("headings render at correct levels", () => {
    const md = renderMarkdown(root(`<h1>One</h1><h2>Two</h2><h3>Three</h3><h6>Six</h6>`))
    expect(md).toContain("# One")
    expect(md).toContain("## Two")
    expect(md).toContain("### Three")
    expect(md).toContain("###### Six")
  })

  test("strong/b → **, em/i → *", () => {
    const md = renderMarkdown(root(`<p><strong>bold</strong> and <em>italic</em> and <b>b</b> and <i>i</i></p>`))
    expect(md).toContain("**bold**")
    expect(md).toContain("*italic*")
    expect(md).toContain("**b**")
    expect(md).toContain("*i*")
  })

  test("unordered lists become - bullets", () => {
    const md = renderMarkdown(root(`<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>`))
    expect(md).toContain("- alpha")
    expect(md).toContain("- beta")
    expect(md).toContain("- gamma")
  })

  test("ordered lists become 1. 2. 3. enumerated", () => {
    const md = renderMarkdown(root(`<ol><li>first</li><li>second</li><li>third</li></ol>`))
    expect(md).toContain("1. first")
    expect(md).toContain("2. second")
    expect(md).toContain("3. third")
  })

  test("links → [text](href), skip javascript:/anchor", () => {
    const md = renderMarkdown(root(`
      <p><a href="https://example.com/x">Link X</a></p>
      <p><a href="javascript:void(0)">JS Link</a></p>
      <p><a href="#section">Anchor</a></p>
    `))
    expect(md).toContain("[Link X](https://example.com/x)")
    expect(md).toContain("JS Link")
    expect(md).not.toContain("[JS Link](javascript:")
    expect(md).toContain("Anchor")
    expect(md).not.toContain("[Anchor](#section)")
  })

  test("tables become markdown pipe tables", () => {
    const md = renderMarkdown(root(`
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>India</td><td>1.4B</td></tr>
        <tr><td>China</td><td>1.4B</td></tr>
      </table>
    `))
    expect(md).toContain("| Name | Value |")
    expect(md).toContain("| --- | --- |")
    expect(md).toContain("| India | 1.4B |")
    expect(md).toContain("| China | 1.4B |")
  })

  test("code blocks use fenced markdown", () => {
    const md = renderMarkdown(root(`<pre><code class="language-ts">const x = 1</code></pre>`))
    expect(md).toContain("```ts")
    expect(md).toContain("const x = 1")
    expect(md).toContain("```")
  })

  test("inline code uses backticks", () => {
    const md = renderMarkdown(root(`<p>The <code>foo</code> function</p>`))
    expect(md).toContain("`foo`")
  })

  test("blockquotes render with > prefix", () => {
    const md = renderMarkdown(root(`<blockquote><p>quoted text</p></blockquote>`))
    expect(md).toContain("> quoted text")
  })

  test("hr renders as ---", () => {
    const md = renderMarkdown(root(`<p>A</p><hr><p>B</p>`))
    expect(md).toContain("---")
  })

  test("script/style/noscript are stripped", () => {
    const md = renderMarkdown(root(`
      <p>visible</p>
      <script>console.log('secret')</script>
      <style>.hidden { display: none }</style>
      <noscript>fallback</noscript>
    `))
    expect(md).toContain("visible")
    expect(md).not.toContain("secret")
    expect(md).not.toContain("display: none")
    expect(md).not.toContain("fallback")
  })

  test("collapses excessive blank lines", () => {
    const md = renderMarkdown(root(`<div><p>A</p><div></div><div></div><p>B</p></div>`))
    expect(md).not.toMatch(/\n\n\n/)
  })
})

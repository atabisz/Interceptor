import { resolveElement } from "../input-simulation"
import { renderMarkdown } from "./markdown-extract"

type Action = { type: string; [key: string]: unknown }
type ActionResult = { success: boolean; error?: string; warning?: string; data?: unknown }

// PRD-70: bump default caps and surface explicit truncation markers.
// Why: PRD-69 bench P9 (Nobel laureates Wikipedia page) — the agent hit the
// silent 10,000-char text cap, didn't know the read was truncated, and
// escaped to ?action=raw to fetch wikitext source. 11 commands, INVALID over
// the bench's 8-cap. Root cause: silent truncation with no signal.
// Fix: larger defaults + explicit marker telling the agent exactly what to do.
const DEFAULT_TEXT_MAX_CHARS = 200_000
const DEFAULT_HTML_MAX_CHARS = 200_000
const ELEMENT_MAX_CHARS = 50_000

function withTruncationMarker(text: string, cap: number): string {
  if (text.length <= cap) return text
  const totalLen = text.length
  return text.slice(0, cap) +
    `\n... (truncated: showed ${cap} of ${totalLen} chars. To see more: scope with 'read e<ref> --text-only', search with 'find "<term>"', or pass 'maxChars=<n>' in raw action. Do NOT fetch ?action=raw or view-source — raw markup is harder to parse than rendered text.)`
}

export async function handleExtractText(action: Action): Promise<ActionResult> {
  const maxChars = typeof action.maxChars === "number" && action.maxChars > 0
    ? action.maxChars
    : DEFAULT_TEXT_MAX_CHARS
  if (action.index !== undefined || action.ref !== undefined) {
    const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
    if (!el) {
      const label = String(action.ref ?? action.index ?? "unknown")
      return { success: false, error: `stale element [${label}] — run interceptor state to refresh` }
    }
    const raw = (el.textContent || "").trim()
    return { success: true, data: withTruncationMarker(raw, Math.min(maxChars, ELEMENT_MAX_CHARS)) }
  }
  return { success: true, data: withTruncationMarker(document.body.innerText, maxChars) }
}

export async function handleExtractMarkdown(action: Action): Promise<ActionResult> {
  const maxChars = typeof action.maxChars === "number" && action.maxChars > 0
    ? action.maxChars
    : DEFAULT_TEXT_MAX_CHARS
  if (action.index !== undefined || action.ref !== undefined) {
    const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
    if (!el) {
      const label = String(action.ref ?? action.index ?? "unknown")
      return { success: false, error: `stale element [${label}] — run interceptor state to refresh` }
    }
    return { success: true, data: withTruncationMarker(renderMarkdown(el), Math.min(maxChars, ELEMENT_MAX_CHARS)) }
  }
  return { success: true, data: withTruncationMarker(renderMarkdown(document.body), maxChars) }
}

export async function handleExtractHtml(action: Action): Promise<ActionResult> {
  const maxChars = typeof action.maxChars === "number" && action.maxChars > 0
    ? action.maxChars
    : DEFAULT_HTML_MAX_CHARS
  if (action.index !== undefined || action.ref !== undefined) {
    const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
    if (!el) {
      const label = String(action.ref ?? action.index ?? "unknown")
      return { success: false, error: `stale element [${label}] — run interceptor state to refresh` }
    }
    return { success: true, data: withTruncationMarker(el.outerHTML, Math.min(maxChars, ELEMENT_MAX_CHARS)) }
  }
  return { success: true, data: withTruncationMarker(document.documentElement.outerHTML, maxChars) }
}

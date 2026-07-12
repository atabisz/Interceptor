import { resolveElement } from "../input-simulation"

type Action = { type: string; [key: string]: unknown }
type ActionResult = { success: boolean; error?: string; warning?: string; data?: unknown }

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function findFileInput(el: Element): HTMLInputElement | null {
  if (el instanceof HTMLInputElement && el.type === "file") return el
  // The ref may point at a label/dropzone that wraps the real input.
  const inner = el.querySelector?.('input[type="file"]') as HTMLInputElement | null
  return inner ?? null
}

// ISOLATED-world synthetic drop. Carries dataTransfer.files (verified), but the
// events are isTrusted:false — fine for dropzones that don't gate on isTrusted.
function isolatedDrop(target: HTMLElement, file: File): void {
  const rect = target.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y }
  for (const type of ["dragenter", "dragover", "drop"]) {
    const dt = new DataTransfer()
    dt.items.add(file)
    target.dispatchEvent(new DragEvent(type, { ...base, dataTransfer: dt }))
  }
}

// Escalate to the MAIN-world trusted-drop bridge in inject-net.js. Bytes cross
// the realm as a blob: URL (a string) — inject-net.js fetches it, builds the
// File in its own realm, and fires a trusted drop (isTrusted:true). Resolves
// true if the bridge acked, false if it never responded (bridge absent).
function bridgedDrop(target: HTMLElement, bytes: Uint8Array, name: string, type: string): Promise<boolean> {
  return new Promise(resolve => {
    const rect = target.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: type || "application/octet-stream" })
    const blobUrl = URL.createObjectURL(blob)
    const id = "fd_" + Math.random().toString(36).slice(2) + Date.now().toString(36)
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      target.removeEventListener("__interceptor_file_drop_ack", onAck as EventListener, true)
      clearTimeout(timer)
      try { URL.revokeObjectURL(blobUrl) } catch {}
      resolve(ok)
    }
    const onAck = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string; ok?: boolean } | undefined
      if (!detail || detail.id !== id) return
      finish(detail.ok === true)
    }
    target.addEventListener("__interceptor_file_drop_ack", onAck as EventListener, true)
    const timer = setTimeout(() => finish(false), 3000)
    target.dispatchEvent(new CustomEvent("__interceptor_file_drop", {
      bubbles: true,
      detail: { id, blobUrl, name, type, x, y }
    }))
  })
}

/**
 * Attach a file to the page — no CDP. Two paths:
 *  - `<input type=file>` target: set `input.files` from a DataTransfer + dispatch
 *    input/change (ISOLATED, like handleInputText). Frameworks read `.files`, not
 *    `.isTrusted`, so no trust bridge is needed.
 *  - dropzone target (or `dropzone:true`): try the MAIN-world trusted-drop bridge
 *    first (works on sites that gate isTrusted), fall back to an ISOLATED
 *    synthetic drop.
 * Bytes arrive base64-encoded in the action (daemon read the file off disk).
 */
export async function handleFileUpload(action: Action): Promise<ActionResult> {
  const el = resolveElement(action.index as number | undefined, action.ref as string | undefined)
  if (!el) {
    return { success: false, error: `stale element [${String(action.ref ?? action.index)}] — run interceptor state to refresh` }
  }

  const fileName = String(action.fileName || "file")
  const mimeType = String(action.mimeType || "application/octet-stream")
  const dataBase64 = action.dataBase64
  if (typeof dataBase64 !== "string") return { success: false, error: "file_upload: missing dataBase64" }

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(dataBase64)
  } catch (e) {
    return { success: false, error: `file_upload: invalid base64 (${(e as Error).message})` }
  }
  const file = new File([bytes.buffer as ArrayBuffer], fileName, { type: mimeType })

  const forceDropzone = action.dropzone === true
  const fileInput = forceDropzone ? null : findFileInput(el)

  // Input path (primary): set input.files + dispatch input/change. ISOLATED.
  if (fileInput) {
    if (fileInput.disabled) return { success: false, error: "file_upload: <input type=file> is disabled" }
    const dt = new DataTransfer()
    dt.items.add(file)
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event("input", { bubbles: true }))
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    return {
      success: true,
      data: { method: "input", fileName, size: bytes.byteLength, multiple: fileInput.multiple, accept: fileInput.accept || null }
    }
  }

  // Dropzone path: MAIN-world trusted bridge first, ISOLATED fallback.
  const target = el as HTMLElement
  const bridged = await bridgedDrop(target, bytes, fileName, mimeType)
  if (bridged) return { success: true, data: { method: "dropzone-trusted", fileName, size: bytes.byteLength } }
  isolatedDrop(target, file)
  return { success: true, data: { method: "dropzone-isolated", fileName, size: bytes.byteLength } }
}

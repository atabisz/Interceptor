import { addTabToInterceptorGroup } from "../tab-group"

type ActionResult = { success: boolean; error?: string; data?: unknown; tabId?: number }

// chrome.windows.* calls can hang indefinitely in a long-lived MV3 service worker.
// Observed in the field: window_focus / window_resize wedged (never resolved) while
// window_list and tab operations kept working — the daemon/CLI then just timed out at
// 15s with no structured error, looking like a dead tool. A hung `await` never throws,
// so the dispatcher's try/catch can't save it. The fix is two-layered:
//   1. Bound every windows API call with a timeout (turns a hang into a fast reject).
//   2. Wrap the whole handler so it ALWAYS returns a structured ActionResult —
//      a timeout or a throw becomes an honest { success:false, error } the CLI can see.
const WINDOW_OP_TIMEOUT_MS = 8000

function withTimeout<T>(op: string, p: Promise<T>, ms = WINDOW_OP_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${op} timed out after ${ms}ms (service worker may be wedged)`)),
        ms
      )
    ),
  ])
}

export async function handleWindowActions(
  action: { type: string; [key: string]: unknown },
  _tabId: number
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "window_create": {
        const win = await withTimeout(
          "window_create",
          chrome.windows.create({
            url: action.url as string | undefined,
            type: (action.windowType as chrome.windows.CreateData["type"]) || "normal",
            width: action.width as number | undefined,
            height: action.height as number | undefined,
            left: action.left as number | undefined,
            top: action.top as number | undefined,
            incognito: !!action.incognito,
            focused: action.focused !== false,
          })
        )
        if (!win) return { success: false, error: "window creation returned no window" }
        const firstTab = win.tabs?.[0]
        let groupId: number | undefined
        if (firstTab?.id && !action.incognito) {
          groupId = await addTabToInterceptorGroup(firstTab.id)
        }
        return {
          success: true,
          data: { windowId: win.id, groupId, tabs: win.tabs?.map(t => ({ id: t.id, url: t.url })) },
        }
      }

      case "window_close":
        await withTimeout("window_close", chrome.windows.remove(action.windowId as number))
        return { success: true }

      case "window_focus":
        await withTimeout(
          "window_focus",
          chrome.windows.update(action.windowId as number, { focused: true })
        )
        return { success: true }

      case "window_resize": {
        const targetId =
          (action.windowId as number) ||
          (await withTimeout("window_getCurrent", chrome.windows.getCurrent())).id
        if (targetId === undefined) return { success: false, error: "no target window id available" }
        await withTimeout(
          "window_resize",
          chrome.windows.update(targetId, {
            width: action.width as number | undefined,
            height: action.height as number | undefined,
            left: action.left as number | undefined,
            top: action.top as number | undefined,
            state: action.state as chrome.windows.UpdateInfo["state"],
          })
        )
        return { success: true }
      }

      case "window_list":
      case "window_get_all": {
        const windows = await withTimeout("window_list", chrome.windows.getAll({ populate: true }))
        return {
          success: true,
          data: windows.map(w => ({
            id: w.id,
            type: w.type,
            state: w.state,
            focused: w.focused,
            width: w.width,
            height: w.height,
            left: w.left,
            top: w.top,
            incognito: w.incognito,
            tabs: w.tabs?.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })),
          })),
        }
      }
    }
    return { success: false, error: `unknown window action: ${action.type}` }
  } catch (err) {
    // Never let a hang or throw escape as a non-response — the wedge bug this guards
    // against is exactly "the handler never returned." Always answer with an error.
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

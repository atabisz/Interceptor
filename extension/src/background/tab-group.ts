export let interceptorGroupId: number | null = null

export async function ensureInterceptorGroup(): Promise<number> {
  if (interceptorGroupId !== null) {
    try {
      await chrome.tabGroups.get(interceptorGroupId)
      return interceptorGroupId
    } catch {
      interceptorGroupId = null
    }
  }
  const groups = await chrome.tabGroups.query({ title: "interceptor" })
  if (groups.length > 0) {
    interceptorGroupId = groups[0].id
    return interceptorGroupId
  }
  return -1
}

export async function addTabToInterceptorGroup(tabId: number): Promise<number> {
  // Tab groups are window-scoped in Chrome — chrome.tabs.group rejects with
  // "Tabs can only be moved to and from normal windows" when the new tab and
  // the cached interceptor group live in different windows (e.g. the cached
  // group is in a non-normal window, or the tab was opened in a different
  // window than the group's). Resolve a per-window interceptor group: if a
  // group with title "interceptor" exists in this window, reuse it; otherwise
  // create one. The module-level interceptorGroupId tracks the most recently
  // used group for fast-path checks (isTabInInterceptorGroup).
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch (err) {
    console.error(`addTabToInterceptorGroup: chrome.tabs.get(${tabId}) failed:`, err)
    return -1
  }
  let windowType: string | undefined
  try {
    if (tab.windowId !== undefined) {
      const win = await chrome.windows.get(tab.windowId)
      windowType = win.type
      console.log(`addTabToInterceptorGroup: tab ${tabId} is in window ${tab.windowId} (type=${windowType})`)
    }
  } catch (err) {
    console.warn(`addTabToInterceptorGroup: chrome.windows.get(${tab.windowId}) failed:`, err)
  }
  // Tab groups only work in normal windows. If Chrome put the tab in a
  // popup/devtools/app window (or our windowType lookup failed), skip
  // grouping rather than throw — the tab is still functional.
  if (windowType !== "normal") {
    console.warn(`addTabToInterceptorGroup: skipping group (window type=${windowType ?? "unknown"})`)
    return -1
  }
  const windowId = tab.windowId
  const groupsInWindow = windowId !== undefined
    ? await chrome.tabGroups.query({ title: "interceptor", windowId })
    : await chrome.tabGroups.query({ title: "interceptor" })
  try {
    if (groupsInWindow.length > 0) {
      const groupId = groupsInWindow[0].id
      console.log(`addTabToInterceptorGroup: reusing group ${groupId} in window ${windowId}`)
      await chrome.tabs.group({ tabIds: tabId, groupId })
      interceptorGroupId = groupId
      return groupId
    }
    console.log(`addTabToInterceptorGroup: creating new group in window ${windowId}`)
    const newGroupId = await chrome.tabs.group({ tabIds: tabId })
    await chrome.tabGroups.update(newGroupId, { title: "interceptor", color: "cyan" })
    interceptorGroupId = newGroupId
    return newGroupId
  } catch (err) {
    console.error(`addTabToInterceptorGroup: chrome.tabs.group failed (tab=${tabId} windowId=${windowId} windowType=${windowType}):`, err)
    return -1
  }
}

export async function isTabInInterceptorGroup(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId)
  if (interceptorGroupId === null) await ensureInterceptorGroup()
  return interceptorGroupId !== null && tab.groupId === interceptorGroupId
}

export const SENSITIVE_ACTIONS = new Set([
  "evaluate", "cookies_get", "cookies_set", "cookies_delete",
  "storage_read", "storage_write", "storage_delete"
])

export async function verifyTabUrl(tabId: number, expectedUrl?: string): Promise<string | null> {
  if (!expectedUrl) return null
  const tab = await chrome.tabs.get(tabId)
  if (tab.url && tab.url !== expectedUrl) {
    return `tab URL changed since last state read — expected ${expectedUrl}, got ${tab.url}`
  }
  return null
}

export function registerTabGroupListeners(): void {
  chrome.tabs.onRemoved.addListener(async (_removedTabId) => {
    if (interceptorGroupId === null) return
    try {
      const tabs = await chrome.tabs.query({ groupId: interceptorGroupId })
      if (tabs.length === 0) interceptorGroupId = null
    } catch {
      interceptorGroupId = null
    }
  })
}

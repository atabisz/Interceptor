import { handleDaemonMessage, drainMessageQueue, pendingRequests } from "./message-dispatch"
import { safeNativePortDisconnect, safeNativePortPing, safeNativePortPost, shouldSkipNativeKeepalive } from "./native-port-lifecycle"
import { recoverPendingRequestsAfterNativeDisconnect } from "./pending-request-recovery"

type ActiveTransport = "none" | "native" | "websocket"
export type HostDeliveryResult = "sent" | "queued" | "failed"

export let nativePort: chrome.runtime.Port | null = null
export let activeTransport: ActiveTransport = "none"
let isConnecting = false
let reconnectDelay = 1000

let wsChannel: WebSocket | null = null
let wsConnecting: WebSocket | null = null
let wsReady = false
let wsKeepAliveTimer: ReturnType<typeof setInterval> | null = null
let keepalivePongTimer: ReturnType<typeof setTimeout> | null = null
let pendingHandshakePort: chrome.runtime.Port | null = null
let lastNativeActivityAt = 0
let lastWsInboundAt = 0
let wsKeepalivesSentSinceAck = 0
let wsAckSupported = false
const WS_URL = "ws://localhost:19222"
export const NATIVE_KEEPALIVE_PONG_TIMEOUT_MS = 15_000
export const RECENT_NATIVE_ACTIVITY_GRACE_MS = 10_000
export const WS_KEEPALIVE_MISS_LIMIT = 2
const OUTBOUND_RECOVERY_QUEUE_CAP = 50
const outboundRecoveryQueue: unknown[] = []

function describeOutboundMessage(msg: unknown): string {
  const candidate = msg as { id?: unknown; result?: { error?: unknown } } | null
  if (candidate && typeof candidate.id === "string") {
    const error = typeof candidate.result?.error === "string" ? ` (${candidate.result.error})` : ""
    return `${candidate.id}${error}`
  }
  return JSON.stringify(msg).slice(0, 200)
}

function emitEvent(event: string, data: Record<string, unknown> = {}) {
  sendToHost({ type: "event", event, ...data })
}

function clearNativeStateFor(port: chrome.runtime.Port | null): void {
  if (nativePort === port) nativePort = null
  if (pendingHandshakePort === port) pendingHandshakePort = null
  if (activeTransport === "native") activeTransport = "none"
}

function disconnectNativePort(port: chrome.runtime.Port | null): void {
  if (!port) return
  safeNativePortDisconnect(port)
  if (keepalivePongTimer) {
    clearTimeout(keepalivePongTimer)
    keepalivePongTimer = null
  }
  clearNativeStateFor(port)
}

function postNative(msg: unknown, port = nativePort): boolean {
  if (!port) return false
  const res = safeNativePortPost(port, msg)
  if (res.posted) return true
  console.error("nativePort.postMessage threw (port disconnected before onDisconnect fired):", res.error)
  clearNativeStateFor(port)
  return false
}

function isWsOpen(): boolean {
  if (!wsReady || !wsChannel || wsChannel.readyState !== WebSocket.OPEN) return false
  return true
}

function sendWs(msg: unknown): boolean {
  const channel = wsChannel
  if (!wsReady || !channel || channel.readyState !== WebSocket.OPEN) return false
  try {
    channel.send(JSON.stringify(msg))
    return true
  } catch {
    return false
  }
}

function enqueueOutboundRecovery(msg: unknown): HostDeliveryResult {
  if (outboundRecoveryQueue.length >= OUTBOUND_RECOVERY_QUEUE_CAP) {
    const dropped = outboundRecoveryQueue.shift()
    console.error("final delivery failure for queued outbound message:", describeOutboundMessage(dropped))
  }
  outboundRecoveryQueue.push(msg)
  return "queued"
}

function drainOutboundRecoveryQueue(): void {
  while (outboundRecoveryQueue.length > 0) {
    const msg = outboundRecoveryQueue[0]
    if (!sendWs(msg)) return
    outboundRecoveryQueue.shift()
  }
}

export function sendToHost(msg: unknown, forceWs?: boolean, allowQueue = false): HostDeliveryResult {
  if (forceWs) {
    if (sendWs(msg)) return "sent"
    return allowQueue ? enqueueOutboundRecovery(msg) : "failed"
  }
  if (activeTransport === "native" && nativePort) {
    if (postNative(msg)) return "sent"
    // fall through to ws channel if native postMessage failed
  }
  if (activeTransport === "websocket" && wsReady && wsChannel) {
    if (sendWs(msg)) return "sent"
    return allowQueue ? enqueueOutboundRecovery(msg) : "failed"
  }
  if (nativePort) {
    if (postNative(msg)) return "sent"
    // fall through to ws channel if native postMessage failed
  }
  if (wsReady && wsChannel) {
    if (sendWs(msg)) return "sent"
  }
  return allowQueue ? enqueueOutboundRecovery(msg) : "failed"
}

export function connectToHost(): void {
  if (nativePort || isConnecting) return
  isConnecting = true

  const port = chrome.runtime.connectNative("com.interceptor.host")

  const handshakeTimer = setTimeout(() => {
    console.error("native host handshake timeout (10s)")
    disconnectNativePort(port)
  }, 10000)

  port.onMessage.addListener((msg: {
    id?: string; type?: string
    action?: { type: string; [key: string]: unknown }
    tabId?: number
  }) => {
    if (msg.type === "pong") {
      lastNativeActivityAt = Date.now()
      if (pendingHandshakePort === port) {
        clearTimeout(handshakeTimer)
        pendingHandshakePort = null
        activeTransport = "native"
        reconnectDelay = 1000
        isConnecting = false
        console.log("native host connected (pong received)")
        emitEvent("connection_established")
        drainMessageQueue()
      }
      if (keepalivePongTimer) {
        clearTimeout(keepalivePongTimer)
        keepalivePongTimer = null
      }
      return
    }
    lastNativeActivityAt = Date.now()
    handleDaemonMessage(msg)
  })

  port.onDisconnect.addListener(() => {
    const disconnectedPort = port
    isConnecting = false
    const lastError = chrome.runtime.lastError
    if (lastError) console.error("native host disconnected:", lastError.message)
    console.log("connection_lost", lastError?.message)
    clearNativeStateFor(disconnectedPort)
    if (isWsOpen()) {
      activeTransport = "websocket"
      console.log("native host down but ws channel active, switching to websocket")
      return
    }
    recoverPendingRequestsAfterNativeDisconnect(
      pendingRequests,
      (msg) => sendToHost(msg, true, true)
    )
    pendingRequests.clear()
    const jitter = Math.random() * reconnectDelay * 0.3
    setTimeout(connectToHost, reconnectDelay + jitter)
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
  })

  nativePort = port
  pendingHandshakePort = port
  const ping = safeNativePortPing(port)
  if (!ping.posted) {
    clearTimeout(handshakeTimer)
    clearNativeStateFor(port)
    isConnecting = false
  }
}

function startWsKeepAlive(): void {
  if (wsKeepAliveTimer) clearInterval(wsKeepAliveTimer)
  wsKeepAliveTimer = setInterval(() => {
    const channel = wsChannel
    if (!channel || channel.readyState !== WebSocket.OPEN) {
      if (wsKeepAliveTimer) clearInterval(wsKeepAliveTimer)
      wsKeepAliveTimer = null
      return
    }
    // Detect half-open ws inline. The outbound setInterval is the one thing
    // reliably running while ws.onmessage is wedged. Once we've seen a
    // keepalive_ack at least once (wsAckSupported), any window of
    // WS_KEEPALIVE_MISS_LIMIT consecutive sent-without-ack keepalives means
    // the OS socket is wedged in a way ws.onmessage won't recover from.
    // Force-close so onclose can trigger a fresh reconnect.
    if (wsAckSupported && wsKeepalivesSentSinceAck >= WS_KEEPALIVE_MISS_LIMIT) {
      console.error(`ws inbound stale (${wsKeepalivesSentSinceAck} unacked) — forcing reconnect`)
      try { channel.close() } catch {}
      stopWsKeepAlive()
      wsReady = false
      wsChannel = null
      if (activeTransport === "websocket") activeTransport = "none"
      setTimeout(() => connectWsChannel(), 500)
      return
    }
    try {
      channel.send(JSON.stringify({ type: "keepalive", timestamp: Date.now() }))
      wsKeepalivesSentSinceAck += 1
    } catch {}
  }, 20_000)
}

function stopWsKeepAlive(): void {
  if (wsKeepAliveTimer) clearInterval(wsKeepAliveTimer)
  wsKeepAliveTimer = null
}

export function connectWsChannel(): void {
  if (wsChannel && (wsChannel.readyState === WebSocket.OPEN || wsChannel.readyState === WebSocket.CONNECTING)) return
  // Guard the gap between `new WebSocket()` and `ws.onopen` setting wsChannel.
  // Without this, concurrent calls (top-level + onInstalled + alarm) each
  // spawn a fresh WebSocket and the daemon ends up with a connection storm.
  if (wsConnecting) return
  try {
    const ws = new WebSocket(WS_URL)
    wsConnecting = ws
    ws.onopen = () => {
      wsConnecting = null
      wsChannel = ws
      wsReady = true
      lastWsInboundAt = Date.now()
      wsKeepalivesSentSinceAck = 0
      ws.send(JSON.stringify({ type: "extension" }))
      startWsKeepAlive()
      console.log("ws channel connected")
      if (activeTransport !== "native") {
        activeTransport = "websocket"
        reconnectDelay = 1000
        isConnecting = false
        console.log("connection ready via ws channel")
        drainMessageQueue()
      }
      drainOutboundRecoveryQueue()
    }
    ws.onmessage = (event) => {
      lastWsInboundAt = Date.now()
      wsKeepalivesSentSinceAck = 0
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : "")
        if (msg.type === "keepalive_ack") {
          wsAckSupported = true
          return
        }
        console.log("ws onmessage:", JSON.stringify(msg).slice(0, 200))
        if (msg.id && msg.action) {
          msg._viaWs = true
          handleDaemonMessage(msg)
        }
      } catch (err) {
        console.error("ws onmessage error:", err)
      }
    }
    ws.onclose = () => {
      if (wsConnecting === ws) wsConnecting = null
      stopWsKeepAlive()
      wsReady = false
      wsChannel = null
      if (activeTransport === "websocket") activeTransport = "none"
    }
    ws.onerror = () => {
      if (wsConnecting === ws) wsConnecting = null
      stopWsKeepAlive()
      wsReady = false
      wsChannel = null
      if (activeTransport === "websocket") activeTransport = "none"
    }
  } catch {}
}

// --- SW Keepalive responder (content script heartbeat) ---
let lastSwKeepalive = 0

export function registerSwKeepaliveListener(): void {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "sw_keepalive") return false
    const now = Date.now()
    if (now - lastSwKeepalive < 20_000) {
      sendResponse({ leader: false })
    } else {
      lastSwKeepalive = now
      sendResponse({ leader: true })
    }
    return false
  })
}

export function registerAlarmListener(): void {
  chrome.alarms.create("keepalive", { periodInMinutes: 0.5 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "keepalive") return

    // Self-heal stuck transport: ws is open but activeTransport never advanced.
    if (activeTransport === "none" && isWsOpen()) {
      console.log("self-heal: ws open but activeTransport=none, promoting to websocket")
      activeTransport = "websocket"
      drainMessageQueue()
    }

    if (!nativePort) connectToHost()
    if (!wsChannel || wsChannel.readyState === WebSocket.CLOSED) connectWsChannel()
    if (activeTransport === "native" && nativePort) {
      if (shouldSkipNativeKeepalive(Date.now(), lastNativeActivityAt, RECENT_NATIVE_ACTIVITY_GRACE_MS)) return
      const port = nativePort
      const res = safeNativePortPing(port)
      if (!res.posted) {
        console.error("native keepalive ping failed:", res.error)
        clearNativeStateFor(port)
        return
      }
      keepalivePongTimer = setTimeout(() => {
        console.error(`keepalive pong timeout (${NATIVE_KEEPALIVE_PONG_TIMEOUT_MS / 1000}s) — forcing reconnect`)
        disconnectNativePort(port)
      }, NATIVE_KEEPALIVE_PONG_TIMEOUT_MS)
    }
  })
}

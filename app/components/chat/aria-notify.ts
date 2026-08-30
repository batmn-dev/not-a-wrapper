/**
 * aria-notify — the announcement registry behind the chat live regions.
 *
 * Port of the reference registry (target.beauty.js 23878–24010, the `Ll` /
 * `wMe`→`CMe`→`yMe`→`bMe` chain): announcements carry an id and
 * interrupt/priority semantics instead of being written straight into a live
 * region. Per (scope, priority) there is one `{active, pending}` queue:
 *
 * - `interrupt: "none"` appends to the queue.
 * - `interrupt: "pending"` first drops queued-but-unspoken announcements from
 *   the same source, then appends.
 * - `interrupt: "all"` additionally replaces the currently active announcement
 *   when it came from the same source.
 *
 * The active announcement is held for 500ms (`EMe`), then the queue advances.
 * `priority: "normal"` renders into the polite region, `"high"` into the
 * assertive one.
 */

export type AriaNotifyPriority = "normal" | "high"
export type AriaNotifyInterrupt = "none" | "pending" | "all"

export type AriaAnnouncement = {
  announcementId: string
  sourceId: string
  scopeId: string
  message: string
  priority: AriaNotifyPriority
  interrupt: AriaNotifyInterrupt
  createdAtMs: number
}

type QueueState = {
  active: AriaAnnouncement | null
  pending: AriaAnnouncement[]
}

export type AriaNotifyOptions = {
  /** Stable source identity; interrupts only affect same-source entries. */
  id?: string
  scopeId?: string
  priority?: AriaNotifyPriority
  interrupt?: AriaNotifyInterrupt
}

/** Reference `fMe("document")`. */
const DOCUMENT_SCOPE_ID = "aria-notify-scope-document"
const DEFAULT_SOURCE_ID = "document"
/** Reference `EMe` — how long the active announcement is held. */
const ANNOUNCEMENT_HOLD_MS = 500

const EMPTY_QUEUE: QueueState = { active: null, pending: [] }

let queues: Record<string, QueueState> = {}
const renderVersions = new Map<string, number>()
const renderCounters = new Map<string, number>()
let announcementCounter = 0
let epoch = 0

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function keyFor(scopeId: string, priority: AriaNotifyPriority): string {
  return `${scopeId}::${priority}`
}

function queueFor(scopeId: string, priority: AriaNotifyPriority): QueueState {
  return queues[keyFor(scopeId, priority)] ?? EMPTY_QUEUE
}

function setQueue(
  scopeId: string,
  priority: AriaNotifyPriority,
  state: QueueState
) {
  const key = keyFor(scopeId, priority)
  if (state.active == null && state.pending.length === 0) {
    if (!(key in queues)) return
    const next = { ...queues }
    delete next[key]
    queues = next
  } else {
    queues = { ...queues, [key]: state }
  }
  emit()
}

function renderVersionFor(
  scopeId: string,
  priority: AriaNotifyPriority
): number | null {
  return renderVersions.get(keyFor(scopeId, priority)) ?? null
}

function setRenderVersion(
  scopeId: string,
  priority: AriaNotifyPriority,
  version: number | null
) {
  const key = keyFor(scopeId, priority)
  if (version == null) renderVersions.delete(key)
  else renderVersions.set(key, version)
}

function nextRenderVersion(
  scopeId: string,
  priority: AriaNotifyPriority
): number {
  const key = keyFor(scopeId, priority)
  const version = (renderCounters.get(key) ?? 0) + 1
  renderCounters.set(key, version)
  return version
}

/** Reference `yMe`: mark the active announcement rendered, then advance the
 * queue after the hold window unless a newer render superseded it. */
function renderActive(scopeId: string, priority: AriaNotifyPriority) {
  setRenderVersion(scopeId, priority, null)
  const version = nextRenderVersion(scopeId, priority)
  const startEpoch = epoch
  setRenderVersion(scopeId, priority, version)
  setTimeout(() => {
    if (
      startEpoch === epoch &&
      renderVersionFor(scopeId, priority) === version
    ) {
      setRenderVersion(scopeId, priority, null)
      advanceQueue(scopeId, priority)
    }
  }, ANNOUNCEMENT_HOLD_MS)
}

/** Reference `bMe`: pop the next pending announcement or reset the queue. */
function advanceQueue(scopeId: string, priority: AriaNotifyPriority) {
  const queue = queueFor(scopeId, priority)
  if (queue.pending.length === 0) {
    setQueue(scopeId, priority, EMPTY_QUEUE)
    setRenderVersion(scopeId, priority, null)
    return
  }
  const [next, ...pending] = queue.pending
  setQueue(scopeId, priority, { active: next, pending })
  renderActive(scopeId, priority)
}

/** Reference `CMe`: interrupt handling and queue insertion. */
function enqueue(announcement: AriaAnnouncement) {
  const { scopeId, priority } = announcement
  const queue = queueFor(scopeId, priority)
  let active = queue.active
  let pending = queue.pending
  if (announcement.interrupt !== "none") {
    pending = pending.filter(
      (entry) => entry.sourceId !== announcement.sourceId
    )
  }
  if (
    (announcement.interrupt === "all" &&
      active?.sourceId === announcement.sourceId) ||
    active == null
  ) {
    active = announcement
  } else {
    pending = [...pending, announcement]
  }
  setQueue(scopeId, priority, { active, pending })
  const activeChanged = queue.active?.announcementId !== active?.announcementId
  if (active == null) {
    setRenderVersion(scopeId, priority, null)
    return
  }
  if (activeChanged || renderVersionFor(scopeId, priority) == null) {
    renderActive(scopeId, priority)
  }
}

/** Reference `wMe` (`Ll`): create and asynchronously enqueue an announcement. */
export function announce(
  message: string,
  options: AriaNotifyOptions = {}
): string {
  const announcement: AriaAnnouncement = {
    announcementId: `aria-notify-${++announcementCounter}`,
    sourceId: options.id ?? DEFAULT_SOURCE_ID,
    scopeId: options.scopeId ?? DOCUMENT_SCOPE_ID,
    message,
    priority: options.priority ?? "normal",
    interrupt: options.interrupt ?? "none",
    createdAtMs: Date.now(),
  }
  const startEpoch = epoch
  void Promise.resolve().then(() => {
    if (startEpoch !== epoch) return
    enqueue(announcement)
  })
  return announcement.announcementId
}

export function subscribeToAnnouncements(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reference `hMe`/`gMe`: the currently rendered announcement per priority. */
export function activeAnnouncement(
  priority: AriaNotifyPriority,
  scopeId: string = DOCUMENT_SCOPE_ID
): AriaAnnouncement | null {
  return queueFor(scopeId, priority).active
}

/** Test-only: drop all queues and timers-in-flight. */
export function resetAriaNotify() {
  epoch += 1
  queues = {}
  renderVersions.clear()
  renderCounters.clear()
  emit()
}

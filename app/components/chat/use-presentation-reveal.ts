"use client"

/**
 * React binding for the Presentation reveal (ADR-0015, plan §6.4).
 *
 * Owns one reveal cursor + fade runtime per `revealKey`, advances it on a
 * self-stopping rAF loop, and exposes the displayed word-boundary prefix of
 * the canonical text. Canonical state stays authoritative and untouched —
 * this hook holds cursors, never a second text buffer.
 *
 * Terminal handling is effect-driven, never rAF-dependent: abnormal
 * terminals (`settleMode: "immediate"`) snap during render so the full text
 * lands in the same commit as the terminal banner; natural completion
 * drains via the settle phase with a setTimeout backstop that force-snaps
 * if animation frames never run (hidden tab). Hidden tabs snap on every
 * canonical update; reduced motion short-circuits the whole mechanism —
 * canonical text, no rAF, no spans, no reveal structure.
 */
import {
  advanceReveal,
  createCaughtUpRevealState,
  createRevealState,
  reconcileCanonical,
  type RevealPhase,
  type RevealProfile,
  type RevealState,
} from "@/lib/chat-performance/presentation-reveal"
import {
  markRevealCaughtUp,
  markRevealCommit,
  markRevealSnap,
  type RevealSnapReason,
} from "@/lib/observability/chat-performance-client"
import {
  createStreamFadeRuntime,
  type StreamFadeRuntime,
} from "@/lib/markdown/rehype-stream-fade"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

type RevealEntry = {
  key: string
  state: RevealState
  runtime: StreamFadeRuntime
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function readReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia) &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  )
}

export function usePresentationReveal(args: {
  text: string // canonical (throttled) text
  live: boolean // transport liveness (submitted/streaming)
  settleMode: "drain" | "immediate" // how to finish when live flips false
  revealKey: string // messageId or reasoning entry id
  profile: RevealProfile
}): {
  text: string
  caughtUp: boolean
  /** Undefined whenever the reveal is disengaged (history rows, reduced
   * motion): no runtime → no plugin → zero reveal structure in the DOM. */
  fadeRuntime: StreamFadeRuntime | undefined
} {
  const { text, live, settleMode, revealKey, profile } = args
  // Subscribed so toggling the OS setting mid-stream takes effect live.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => false
  )

  const [displayed, setDisplayed] = useState<string>(() => (live ? "" : text))
  const entryRef = useRef<RevealEntry | null>(null)
  const rafRef = useRef<number | null>(null)
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phaseRef = useRef<RevealPhase>("streaming")
  const settleStartedAtRef = useRef<number | null>(null)
  const pendingCommitMarkRef = useRef(false)
  const textRef = useRef(text)
  textRef.current = text
  const profileRef = useRef(profile)
  profileRef.current = profile

  // The machinery engages for live rows and stays engaged through the
  // settle drain; rows that were never live (history) bypass it entirely.
  const engaged = !reducedMotion && (live || entryRef.current !== null)

  const snapToCanonical = useCallback((reason: RevealSnapReason) => {
    const entry = entryRef.current
    if (!entry) return
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (backstopRef.current !== null) {
      clearTimeout(backstopRef.current)
      backstopRef.current = null
    }
    const canonical = textRef.current
    if (entry.state.displayedEnd >= canonical.length) {
      // Already caught up: nothing snaps in, so don't arm the runtime's
      // one-shot snap — it would suppress the first fade of text that
      // arrives after (e.g. hiding a drained tab, then returning).
      return
    }
    entry.state = createCaughtUpRevealState(canonical)
    entry.runtime.prune(null)
    entry.runtime.snap()
    markRevealSnap(reason)
    setDisplayed(canonical)
  }, [])

  const runFrame = useCallback(function frame(nowMs: number) {
    rafRef.current = null
    const entry = entryRef.current
    if (!entry) return
    const result = advanceReveal(
      entry.state,
      entry.state.canonical,
      nowMs,
      profileRef.current,
      phaseRef.current
    )
    entry.state = result.state
    if (result.lagSnapped) {
      // Hard lag cap jumped the frontier: the jumped-over text must render
      // already-revealed — no fade births for this commit's words.
      entry.runtime.snap()
    }
    if (result.shouldCommit) {
      pendingCommitMarkRef.current = true
      setDisplayed(entry.state.canonical.slice(0, result.state.displayedEnd))
    }
    if (result.caughtUp) {
      // Loop self-stops; a settle backstop is no longer needed once the
      // drain finished naturally.
      if (phaseRef.current === "settling") {
        if (backstopRef.current !== null) {
          clearTimeout(backstopRef.current)
          backstopRef.current = null
        }
        if (settleStartedAtRef.current !== null) {
          markRevealCaughtUp(nowMs - settleStartedAtRef.current)
          settleStartedAtRef.current = null
        }
      }
      return
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [])

  // Idempotent: a running loop is left alone; starting from idle resets the
  // tick clock so idle time is never consumed as reveal time.
  const startLoop = useCallback(() => {
    if (typeof requestAnimationFrame === "undefined") return
    if (rafRef.current !== null) return
    const entry = entryRef.current
    if (!entry) return
    entry.state = { ...entry.state, lastTickMs: -1 }
    rafRef.current = requestAnimationFrame(runFrame)
  }, [runFrame])

  // Render-phase entry management (assistant-ui's render-phase resync).
  if (engaged) {
    let entry = entryRef.current
    if (entry === null || entry.key !== revealKey) {
      // New reveal target. Empty text reveals from empty (a live new
      // message types out); non-empty text at engagement is mid-stream
      // adoption (remount, reduced-motion off, continuation) — it shows
      // instantly and only later appends animate.
      const runtime = createStreamFadeRuntime()
      const state =
        live && text.length === 0
          ? createRevealState(text, true)
          : createCaughtUpRevealState(text)
      // Adopted text renders without queued fades; an empty start keeps
      // normal fades for the words that stream in.
      if (text.length > 0) runtime.snap()
      entry = { key: revealKey, state, runtime }
      entryRef.current = entry
      phaseRef.current = live ? "streaming" : "settling"
      const target = text.slice(0, state.displayedEnd)
      if (displayed !== target) setDisplayed(target)
    } else if (displayed !== "" && !text.startsWith(displayed)) {
      // Render-phase resync (assistant-ui): a same-key correction/shrink
      // must never paint the stale displayed text against the new
      // canonical — the always-prefix invariant holds within this very
      // render, not one effect later. A live row restarts from empty; a
      // settling row shows the corrected canonical instantly.
      entry.state = live
        ? createRevealState(text, true)
        : createCaughtUpRevealState(text)
      entry.runtime.prune(null)
      if (!live) entry.runtime.snap()
      setDisplayed(live ? "" : text)
    } else if (!live && settleMode === "immediate" && displayed !== text) {
      // Abnormal terminal (Stop/failure/approval/error): the full text must
      // land in the SAME commit as the terminal banner — snap during render.
      entry.state = createCaughtUpRevealState(text)
      entry.runtime.prune(null)
      entry.runtime.snap()
      setDisplayed(text)
    }
  }

  // Reduced motion tears the machinery down outright.
  useEffect(() => {
    if (!reducedMotion) return
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (backstopRef.current !== null) {
      clearTimeout(backstopRef.current)
      backstopRef.current = null
    }
    entryRef.current = null
  }, [reducedMotion])

  // Canonical updates: reconcile (append extends fence spans; non-prefix
  // change or shrink snaps to a fresh cursor), hidden tabs snap outright,
  // and growth (re)starts the loop.
  useEffect(() => {
    if (reducedMotion) return
    const entry = entryRef.current
    if (!entry) return
    if (document.visibilityState === "hidden") {
      snapToCanonical("hidden")
      return
    }
    const { state, discontinuity } = reconcileCanonical(entry.state, text, false)
    entry.state = state
    if (discontinuity === "snap") {
      entry.runtime.prune(null)
      markRevealSnap("nonprefix")
      setDisplayed("")
    }
    startLoop()
  }, [text, reducedMotion, snapToCanonical, startLoop])

  // Liveness flip: natural completion drains within the settle window, with
  // a timer backstop that force-snaps if frames never run (hidden tab).
  useEffect(() => {
    if (reducedMotion) return
    const entry = entryRef.current
    if (!entry) return
    if (live) {
      phaseRef.current = "streaming"
      settleStartedAtRef.current = null
      return
    }
    phaseRef.current = "settling"
    if (settleMode === "immediate") {
      // Render-phase snap already landed the text; record the cause here so
      // the mark fires once, effect-driven, outside render.
      markRevealSnap("terminal")
      return
    }
    if (document.visibilityState === "hidden") {
      snapToCanonical("hidden")
      return
    }
    settleStartedAtRef.current =
      typeof performance !== "undefined" ? performance.now() : 0
    startLoop()
    backstopRef.current = setTimeout(() => {
      backstopRef.current = null
      snapToCanonical("backstop")
    }, profileRef.current.settleDrainMs + 100)
    return () => {
      if (backstopRef.current !== null) {
        clearTimeout(backstopRef.current)
        backstopRef.current = null
      }
    }
  }, [live, settleMode, reducedMotion, snapToCanonical, startLoop])

  // Going hidden mid-stream snaps immediately (final state must never
  // depend on animation frames); returning visible needs no action — the
  // caught-up cursor re-arms the word reveal for text that arrives after.
  useEffect(() => {
    if (reducedMotion) return
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && entryRef.current) {
        snapToCanonical("hidden")
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [reducedMotion, snapToCanonical])

  // A settled, fully drained row releases its machinery: later canonical
  // edits render directly (engaged flips false) instead of re-animating.
  useEffect(() => {
    if (live || entryRef.current === null) return
    if (
      displayed === text &&
      rafRef.current === null &&
      backstopRef.current === null
    ) {
      entryRef.current = null
    }
  }, [live, displayed, text])

  // reveal_commit fires post-commit (from the effect the committed
  // `displayed` value triggers), matching this seam's documented timing —
  // marks measure commit time, not scheduling time.
  useEffect(() => {
    if (!pendingCommitMarkRef.current) return
    pendingCommitMarkRef.current = false
    const entry = entryRef.current
    if (!entry) return
    markRevealCommit(
      entry.state.displayedEnd,
      Math.max(0, entry.state.canonical.length - entry.state.displayedEnd)
    )
  }, [displayed])

  useEffect(
    () => () => {
      // Refs must be nulled, not just cancelled: under StrictMode's
      // mount→unmount→remount, a stale non-null rafRef would make every
      // later startLoop() no-op and the reveal would buffer until the
      // terminal snap.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (backstopRef.current !== null) {
        clearTimeout(backstopRef.current)
        backstopRef.current = null
      }
    },
    []
  )

  if (!engaged) {
    // No runtime at all: the Markdown pipeline installs no plugin, so a
    // reduced-motion or never-live row carries zero reveal structure.
    return {
      text,
      caughtUp: true,
      fadeRuntime: undefined,
    }
  }
  return {
    text: displayed,
    caughtUp: displayed === text,
    fadeRuntime: entryRef.current!.runtime,
  }
}

"use client"

import { Composer } from "@/app/components/chat-input/composer"
import { ActivityPanel } from "@/app/components/chat/activity/activity-panel"
import {
  ActivityPanelStoreProvider,
  createActivityPanelStore,
} from "@/app/components/chat/activity/activity-panel-store"
import { AssistantActivityIndicator } from "@/app/components/chat/assistant-activity-indicator"
import { SourcesList } from "@/app/components/chat/sources-list"
import { ThreadBottomContainer } from "@/app/components/chat/thread-bottom-container"
import {
  THREAD_GUTTER_VARS,
  THREAD_MAXWIDTH_VARS,
} from "@/app/components/chat/thread-bounds"
import { ThreadScrollEdge } from "@/app/components/chat/thread-scroll"
import { TurnContextProvider } from "@/app/components/chat/turn-context"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { useBrowserLayoutEffect } from "@/app/hooks/use-browser-layout-effect"
import { Icon } from "@/components/ui/icon"
import {
  Loader,
  StreamingCaret,
  type StreamingIndicatorVariant,
} from "@/components/ui/loader"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningLabel,
} from "@/components/ui/reasoning"
import { useStickyPaddingBottom } from "@/components/ui/scroll-root"
import { SystemMessage } from "@/components/ui/system-message"
import { ThinkingBar } from "@/components/ui/thinking-bar"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { cn } from "@/lib/utils"
import { RiFileCopyLine, RiRefreshLine } from "@remixicon/react"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  ACTIVITY_PANEL_FIXTURES,
  type ActivityFixtureKey,
} from "./fixtures/activity.fixture"
import {
  THREAD_INSET_FIXTURES,
  THREAD_LIFECYCLE_FIXTURES,
  THREAD_SURFACE_FIXTURES,
  type ThreadInsetFixtureKey,
  type ThreadLifecycleFixtureKey,
  type ThreadSurfaceFixtureKey,
} from "./fixtures/thread-bottom.fixture"

// ─── Constants ───────────────────────────────────────────────────────────────

const STREAMING_INDICATOR_VARIANT: StreamingIndicatorVariant = "caret"

const PROSE_CLASSES = "markdown prose relative w-full bg-transparent p-0"

const SAMPLE_REASONING = `The user is asking about quantum computing fundamentals. Let me break this down step by step.

First, I need to consider the basics of quantum mechanics that underpin quantum computing:
- **Superposition**: A qubit can exist in multiple states simultaneously
- **Entanglement**: Qubits can be correlated in ways that have no classical analog
- **Interference**: Quantum states can constructively or destructively interfere

Now, regarding the specific question about quantum error correction, this is one of the most active areas of research. The threshold theorem tells us that if the error rate per gate is below a certain threshold, we can perform arbitrarily long quantum computations reliably.

Let me formulate a clear explanation that addresses all of these points...`

const MARKDOWN_RESPONSE = `# Heading 1

## Heading 2

### Heading 3

#### Heading 4

This is a paragraph with **bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`. You can also combine **_bold and italic_** together.

Here's a [link to an example](https://example.com) inline with text.

---

## Lists

### Unordered List
- First item
- Second item with **bold**
- Third item
  - Nested item A
  - Nested item B
    - Deeply nested

### Ordered List
1. Step one
2. Step two
3. Step three
   1. Sub-step 3a
   2. Sub-step 3b

---

## Blockquotes

> This is a blockquote. It can contain **formatted text** and span multiple lines.
>
> — Someone wise

---

## Code Blocks

Inline code: \`const x = 42\`

\`\`\`typescript
interface User {
  id: string
  name: string
  email: string
  role: "admin" | "user" | "viewer"
}

async function fetchUsers(): Promise<User[]> {
  const response = await fetch("/api/users")
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}\`)
  }
  return response.json()
}
\`\`\`

\`\`\`python
def fibonacci(n: int) -> list[int]:
    """Generate Fibonacci sequence up to n terms."""
    if n <= 0:
        return []
    sequence = [0, 1]
    for _ in range(2, n):
        sequence.append(sequence[-1] + sequence[-2])
    return sequence[:n]
\`\`\`

---

## Tables

| Feature | Status | Priority |
|---------|--------|----------|
| Authentication | ✅ Complete | High |
| Dark mode | ✅ Complete | Medium |
| File uploads | 🔄 In progress | High |
| Analytics | ❌ Not started | Low |

---

## Math

The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.

---

## Task List

- [x] Research phase complete
- [x] Implementation started
- [ ] Testing pending
- [ ] Documentation needed

That covers all the major markdown formatting elements!`

// ─── Mock data for tool & source components ──────────────────────────────────

const MOCK_SOURCES: SourceUrlUIPart[] = [
  {
    type: "source-url",
    sourceId: "src-1",
    url: "https://en.wikipedia.org/wiki/Quantum_computing",
    title: "Quantum computing - Wikipedia",
  },
  {
    type: "source-url",
    sourceId: "src-2",
    url: "https://arxiv.org/abs/2301.12345",
    title: "Advances in Quantum Error Correction",
  },
  {
    type: "source-url",
    sourceId: "src-3",
    url: "https://nature.com/articles/s41586-023-05837-9",
    title: "Suppressing quantum errors by scaling a surface code",
  },
  {
    type: "source-url",
    sourceId: "src-4",
    url: "https://research.google/pubs/quantum-supremacy",
    title: "Quantum Supremacy Using a Programmable Processor",
  },
]

const STREAMING_CARET_VARIANTS: StreamingIndicatorVariant[] = [
  "rotating-glyph",
  "wave-segment",
  "slide-dot-trail",
  "pulse-dot",
  "shimmer-underscore",
  "soft-glow-marker",
]

const LOADER_VARIANTS = [
  { variant: "circular" as const, label: "circular" },
  { variant: "classic" as const, label: "classic" },
  { variant: "pulse" as const, label: "pulse" },
  { variant: "pulse-dot" as const, label: "pulse-dot" },
  { variant: "dots" as const, label: "dots" },
  { variant: "typing" as const, label: "typing" },
  { variant: "wave" as const, label: "wave" },
  { variant: "bars" as const, label: "bars" },
  { variant: "terminal" as const, label: "terminal" },
  { variant: "text-blink" as const, label: "text-blink" },
  { variant: "chat" as const, label: "chat" },
]

// ─── Small helpers ───────────────────────────────────────────────────────────

function useLiveTimer() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])
  return seconds
}

function StateAnnotation({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border/40 bg-muted/30 mt-1 mb-10 rounded-lg border px-3 py-2.5">
      <div className="text-foreground/70 text-[14px] leading-snug font-semibold">
        {title}
      </div>
      <div className="text-muted-foreground mt-1 text-[14px] leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function ArticleWrapper({
  children,
  role,
}: {
  children: React.ReactNode
  role: "user" | "assistant"
}) {
  return (
    <article
      className={cn(
        `mx-auto w-full px-[var(--thread-content-margin,1rem)] text-base ${THREAD_GUTTER_VARS}`,
        role === "user" && "scroll-mt-[var(--spacing-app-header)] pt-3",
        role === "assistant" &&
          "scroll-mt-[calc(var(--spacing-app-header)+min(200px,max(70px,20svh)))] pb-10"
      )}
      data-turn={role}
    >
      <div
        className={`group/turn-messages relative mx-auto flex w-full max-w-[var(--thread-content-max-width,40rem)] min-w-0 flex-1 flex-col ${THREAD_MAXWIDTH_VARS}`}
      >
        {children}
      </div>
    </article>
  )
}

function UserBubble({ children }: { children: string }) {
  return (
    <ArticleWrapper role="user">
      <Message
        as="div"
        className="flex max-w-full flex-col gap-0"
        data-turn="user"
        tabIndex={-1}
      >
        <h5 className="sr-only">You said:</h5>
        <div className="flex max-w-full grow flex-col gap-4">
          <div className="text-message relative flex min-h-8 w-full flex-col items-end gap-2 text-start break-words whitespace-normal">
            <div className="flex w-full flex-col items-end gap-1 empty:hidden">
              <MessageContent
                className="bg-accent prose relative max-w-[var(--user-chat-width,70%)] min-w-0 overflow-hidden rounded-[22px] px-4 py-2.5 leading-6"
                markdown={false}
              >
                <div className="max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {children}
                </div>
              </MessageContent>
            </div>
          </div>
        </div>
      </Message>
    </ArticleWrapper>
  )
}

function AssistantShell({
  children,
}: {
  children: React.ReactNode
  isLast?: boolean
}) {
  const msgId = useId()
  return (
    <ArticleWrapper role="assistant">
      <Message
        as="div"
        className="flex max-w-full flex-col gap-0"
        data-turn="assistant"
        data-message-id={msgId}
        tabIndex={-1}
      >
        <h6 className="sr-only">Assistant said:</h6>
        <div className="flex max-w-full grow flex-col gap-4">
          <div className="text-message relative flex min-h-8 w-full flex-col gap-2 text-start break-words whitespace-normal">
            <div className="flex w-full flex-col gap-1 empty:hidden">
              {children}
            </div>
          </div>
        </div>
      </Message>
    </ArticleWrapper>
  )
}

function CopyRegenActions() {
  return (
    <MessageActions
      className={cn(
        "-ml-2 flex gap-0",
        "pointer-events-none",
        "[mask-image:linear-gradient(to_right,black_33%,transparent_66%)]",
        "[mask-size:300%_100%]",
        "[mask-position:100%_0%]",
        "motion-safe:transition-[mask-position]",
        "duration-[1.5s]",
        "group-hover/turn-messages:pointer-events-auto",
        "group-hover/turn-messages:[mask-position:0_0]",
        "group-focus-within/turn-messages:pointer-events-auto",
        "group-focus-within/turn-messages:[mask-position:0_0]",
        "has-[[data-state=open]]:pointer-events-auto",
        "has-[[data-state=open]]:[mask-position:0_0]",
        "pointer-coarse:pointer-events-auto",
        "pointer-coarse:[mask-image:none]"
      )}
    >
      <MessageAction tooltip="Copy Response" side="bottom">
        <button
          className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Copy Response"
          type="button"
        >
          <Icon icon={RiFileCopyLine} slotSize={20} />
        </button>
      </MessageAction>
      <MessageAction
        tooltip={
          <span className="flex flex-col items-center text-center leading-tight">
            <span className="font-medium">Try again...</span>
            <span className="text-[var(--text-tertiary)]">Using GPT-5.5</span>
          </span>
        }
        side="bottom"
        delay={0}
      >
        <button
          className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Try again with GPT-5.5"
          type="button"
        >
          <Icon icon={RiRefreshLine} slotSize={20} />
        </button>
      </MessageAction>
    </MessageActions>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ThinkingStatesTestPage() {
  const liveSeconds = useLiveTimer()
  const [activityFixtureStore] = useState(() => createActivityPanelStore())
  const [activityFixtureKey, setActivityFixtureKey] =
    useState<ActivityFixtureKey>("completed")
  const [activityOpen, setActivityOpen] = useState(true)
  const [threadLifecycleKey, setThreadLifecycleKey] =
    useState<ThreadLifecycleFixtureKey>("idle")
  const [threadSurfaceKey, setThreadSurfaceKey] =
    useState<ThreadSurfaceFixtureKey>("existing")
  const [threadInsetKey, setThreadInsetKey] =
    useState<ThreadInsetFixtureKey>("none")
  const activityFixture = ACTIVITY_PANEL_FIXTURES[activityFixtureKey]
  const threadLifecycle = THREAD_LIFECYCLE_FIXTURES[threadLifecycleKey]
  const threadSurface = THREAD_SURFACE_FIXTURES[threadSurfaceKey]
  const threadInset = THREAD_INSET_FIXTURES[threadInsetKey]
  const threadBottomRef = useStickyPaddingBottom(!threadSurface.isOnboarding)
  const fixtureRootRef = useRef<HTMLDivElement>(null)
  const { theme = "system", setTheme } = useTheme()

  const noop = useCallback(() => {}, [])

  useBrowserLayoutEffect(() => {
    const scrollRoot =
      fixtureRootRef.current?.closest<HTMLElement>("[data-scroll-root]")
    if (!scrollRoot) return

    const previousSafeArea = scrollRoot.style.getPropertyValue(
      "--safe-area-inset-bottom"
    )
    const previousKeyboard = scrollRoot.style.getPropertyValue(
      "--screen-keyboard-height"
    )
    const wasKeyboardOpen = scrollRoot.hasAttribute("data-keyboard-open")
    const hadKeyboardHeightOverride = scrollRoot.hasAttribute(
      "data-screen-keyboard-height-override"
    )

    scrollRoot.setAttribute("data-screen-keyboard-height-override", "")
    scrollRoot.style.setProperty(
      "--safe-area-inset-bottom",
      threadInset.safeArea
    )
    scrollRoot.style.setProperty(
      "--screen-keyboard-height",
      threadInset.keyboard
    )
    scrollRoot.toggleAttribute(
      "data-keyboard-open",
      Number.parseFloat(threadInset.keyboard) > 0
    )

    return () => {
      if (previousSafeArea) {
        scrollRoot.style.setProperty(
          "--safe-area-inset-bottom",
          previousSafeArea
        )
      } else {
        scrollRoot.style.removeProperty("--safe-area-inset-bottom")
      }
      if (previousKeyboard) {
        scrollRoot.style.setProperty(
          "--screen-keyboard-height",
          previousKeyboard
        )
      } else {
        scrollRoot.style.removeProperty("--screen-keyboard-height")
      }
      scrollRoot.toggleAttribute(
        "data-screen-keyboard-height-override",
        hadKeyboardHeightOverride
      )
      scrollRoot.toggleAttribute("data-keyboard-open", wasKeyboardOpen)
    }
  }, [threadInset])

  return (
    <MessagesProvider>
      <LayoutApp>
        <ActivityPanelStoreProvider
          store={activityFixtureStore}
          panelId="thinking-states-activity-panel"
        >
          <ActivityPanel
            panelId="thinking-states-activity-panel"
            open={activityOpen}
            onOpenChange={setActivityOpen}
            title="Activity"
            durationSeconds={activityFixture.durationSeconds}
            activity={activityFixture.activity}
            onToolApproval={
              activityFixture.approvalActionsEnabled ? noop : undefined
            }
          />
        </ActivityPanelStoreProvider>
        <div
          ref={fixtureRootRef}
          data-thread-fixture=""
          data-thread-lifecycle={threadLifecycleKey}
          data-thread-surface={threadSurfaceKey}
          data-thread-inset={threadInsetKey}
          className="relative flex min-h-0 flex-1 flex-col items-center"
        >
          <div className="border-border bg-card text-muted-foreground z-20 mt-3 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs">
            <label className="flex items-center gap-2">
              Activity fixture
              <select
                aria-label="Activity fixture"
                value={activityFixtureKey}
                onChange={(event) =>
                  setActivityFixtureKey(
                    event.target.value as ActivityFixtureKey
                  )
                }
                className="text-foreground rounded-md bg-transparent text-sm outline-none"
              >
                {Object.entries(ACTIVITY_PANEL_FIXTURES).map(
                  ([key, fixture]) => (
                    <option key={key} value={key}>
                      {fixture.label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Footer state
              <select
                aria-label="Footer state"
                value={threadLifecycleKey}
                onChange={(event) =>
                  setThreadLifecycleKey(
                    event.target.value as ThreadLifecycleFixtureKey
                  )
                }
                className="text-foreground rounded-md bg-transparent text-sm outline-none"
              >
                {Object.entries(THREAD_LIFECYCLE_FIXTURES).map(
                  ([key, fixture]) => (
                    <option key={key} value={key}>
                      {fixture.label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Surface
              <select
                aria-label="Thread surface"
                value={threadSurfaceKey}
                onChange={(event) =>
                  setThreadSurfaceKey(
                    event.target.value as ThreadSurfaceFixtureKey
                  )
                }
                className="text-foreground rounded-md bg-transparent text-sm outline-none"
              >
                {Object.entries(THREAD_SURFACE_FIXTURES).map(
                  ([key, fixture]) => (
                    <option key={key} value={key}>
                      {fixture.label}
                    </option>
                  )
                )}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Insets
              <select
                aria-label="Viewport insets"
                value={threadInsetKey}
                onChange={(event) =>
                  setThreadInsetKey(event.target.value as ThreadInsetFixtureKey)
                }
                className="text-foreground rounded-md bg-transparent text-sm outline-none"
              >
                {Object.entries(THREAD_INSET_FIXTURES).map(([key, fixture]) => (
                  <option key={key} value={key}>
                    {fixture.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Theme
              <select
                aria-label="Theme"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                className="text-foreground rounded-md bg-transparent text-sm outline-none"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <button
              type="button"
              disabled={activityOpen}
              onClick={() => setActivityOpen(true)}
              className="text-foreground rounded-md px-2 py-1 disabled:opacity-40"
            >
              Open Activity
            </button>
          </div>
          {/* ━━━ Conversation ━━━ */}
          <div className="relative -mb-(--composer-overlap-px) flex w-full grow basis-auto flex-col items-center pt-4 pb-(--composer-overlap-px) [--composer-overlap-px:28px]">
            {threadSurface.isOnboarding ? (
              <div className="flex min-h-[calc(42svh-var(--spacing-app-header))] w-full grow flex-col items-center justify-end max-sm:justify-center">
                <h1 className="inline-flex min-h-[42px] items-baseline px-1 text-2xl leading-9 font-normal text-balance">
                  What&apos;s on your mind?
                </h1>
              </div>
            ) : (
              <>
                {/* ─── User message ─── */}
                <UserBubble>This is a test chat thread</UserBubble>

                {/* ─── Submitted state: ThinkingBar ─── */}
                <AssistantShell>
                  <ThinkingBar text="Thinking" />
                  <StateAnnotation title="ThinkingBar — status: submitted">
                    Appears immediately after the user sends a message, before
                    the API stream begins. Triggered when{" "}
                    <code>status === &quot;submitted&quot;</code> and the last
                    message is from the user. Rendered by{" "}
                    <code>conversation.tsx</code> outside the message list.
                    Disappears once the first streaming chunk arrives and status
                    transitions to <code>&quot;streaming&quot;</code>.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Reasoning states ─── */}
                <AssistantShell>
                  <Reasoning
                    isStreaming={true}
                    phase="thinking"
                    durationSeconds={liveSeconds}
                    opaque={false}
                  >
                    <ReasoningLabel />
                    <ReasoningContent markdown>
                      {SAMPLE_REASONING}
                    </ReasoningContent>
                  </Reasoning>
                  <StateAnnotation title="Reasoning — thinking (visible text)">
                    Active when reasoning parts are streaming (
                    <code>part.state === &quot;streaming&quot;</code>). The
                    shimmer &quot;Thinking&quot; label + live timer tick every
                    second. Content auto-expands while streaming. Used by models
                    like Claude 3.5/4 that share their chain-of-thought. Derived
                    by <code>useReasoningPhase</code> from the{" "}
                    <code>parts</code> array in{" "}
                    <code>message-assistant.tsx</code>.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Reasoning
                    isStreaming={true}
                    phase="thinking"
                    durationSeconds={liveSeconds}
                    opaque={true}
                  >
                    <ReasoningLabel />
                  </Reasoning>
                  <StateAnnotation title="Reasoning — thinking (opaque)">
                    Same thinking phase, but the model doesn&apos;t expose its
                    reasoning text (e.g., OpenAI o1/o3).{" "}
                    <code>isOpaqueReasoning</code> is true when reasoning parts
                    exist but have no visible text. Shows the shimmer label +
                    timer but no toggle chevron and no expandable content. The{" "}
                    <code>opaque</code> prop forces <code>isOpen</code> to false
                    in the Reasoning context.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Reasoning
                    isStreaming={false}
                    phase="complete"
                    durationSeconds={12}
                    opaque={false}
                  >
                    <ReasoningLabel />
                    <ReasoningContent markdown>
                      {SAMPLE_REASONING}
                    </ReasoningContent>
                  </Reasoning>
                  <StateAnnotation title="Reasoning — complete (with duration)">
                    After reasoning finishes (
                    <code>part.state === &quot;done&quot;</code> or{" "}
                    <code>status === &quot;ready&quot;</code>), phase
                    transitions to <code>&quot;complete&quot;</code>. The label
                    changes to &quot;Thought for Xs&quot; using the frozen timer
                    value or persisted <code>metadata.reasoningDurationMs</code>
                    . Content auto-collapses when streaming ends. User can click
                    the chevron to re-expand and read the reasoning.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Reasoning
                    isStreaming={false}
                    phase="complete"
                    durationSeconds={undefined}
                    opaque={false}
                  >
                    <ReasoningLabel />
                    <ReasoningContent markdown>
                      {SAMPLE_REASONING}
                    </ReasoningContent>
                  </Reasoning>
                  <StateAnnotation title="Reasoning — complete (no duration)">
                    Fallback when <code>durationSeconds</code> is undefined —
                    either the timer never ticked (non-last message loaded from
                    history) or
                    <code>metadata.reasoningDurationMs</code> wasn&apos;t
                    persisted. The label shows &quot;Thought&quot; without a
                    time. Same toggle behavior.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Reasoning
                    isStreaming={false}
                    phase="complete"
                    durationSeconds={8}
                    opaque={true}
                  >
                    <ReasoningLabel />
                  </Reasoning>
                  <StateAnnotation title="Reasoning — complete (opaque)">
                    The finished state for opaque-reasoning models (o1/o3).
                    Shows &quot;Thought for 8s&quot; but no chevron or
                    expandable content. Rendered as a static{" "}
                    <code>&lt;span&gt;</code> instead of a{" "}
                    <code>&lt;button&gt;</code> since there&apos;s nothing to
                    toggle.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Loader states ─── */}
                <AssistantShell>
                  <AssistantActivityIndicator
                    presentation={{
                      kind: "live-status",
                      semanticKind: "thinking",
                      label: "Thinking",
                      motion: "shimmer",
                    }}
                    open={false}
                  />
                  <StateAnnotation title='Assistant activity — "Thinking" (no caret)'>
                    The canonical content-empty live state. It uses the
                    normalized
                    <code>live-status</code> presentation, has visible status
                    copy, and does not create disclosure semantics until
                    inspectable Activity sections exist.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <AssistantActivityIndicator
                    presentation={{
                      kind: "passive",
                      label: "Thought for <1s",
                      durationSeconds: 0,
                    }}
                    open={false}
                  />
                  <StateAnnotation title="Assistant activity — passive opaque timing">
                    Sub-second opaque reasoning stays honest instead of being
                    suppressed or rounded up: no focus target, chevron, or
                    disclosure ARIA.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <AssistantActivityIndicator
                    presentation={{
                      kind: "disclosure",
                      label: "Searching the web",
                      motion: "shimmer",
                      activity: {
                        entries: [
                          {
                            id: "search-fixture",
                            kind: "search",
                            title: "Searching the web",
                            status: "running",
                            sources: [MOCK_SOURCES[0]!],
                          },
                        ],
                        sourceResults: [MOCK_SOURCES[0]!],
                        imageResults: [],
                      },
                    }}
                    open={false}
                    onOpenChange={noop}
                    controlsId="thinking-states-activity"
                  />
                  <StateAnnotation title="Assistant activity — rich live disclosure">
                    The same renderer composes search, image, approval, and
                    named tool labels while keeping the action tied to a
                    non-empty chronological activity model.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Loader variant="loading-dots" text="Searching the web" />
                  <StateAnnotation title='Loader — "Searching the web" (loading-dots)'>
                    Appears when a single tool invocation is in progress (
                    <code>state !== &quot;output-available&quot;</code>) and the
                    tool name matches <code>web_search</code> or{" "}
                    <code>google_search</code>. Controlled by{" "}
                    <code>useLoadingState</code> → <code>showToolProgress</code>
                    . The label is formatted by{" "}
                    <code>formatToolProgressLabel()</code> in{" "}
                    <code>message-assistant.tsx</code>.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Loader variant="loading-dots" text="Running tools" />
                  <StateAnnotation title='Loader — "Running tools" (loading-dots)'>
                    Same as above but when multiple tools are active
                    simultaneously (<code>activeToolNames.length &gt; 1</code>).
                    The generic &quot;Running tools&quot; label replaces the
                    specific tool name. Common during multi-step agent
                    workflows.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <Loader variant="loading-dots" text="Generating image" />
                  <StateAnnotation title='Loader — "Generating image" (loading-dots)'>
                    Triggered when any in-progress tool part has the name{" "}
                    <code>imageGeneration</code> or
                    <code>image_generation</code>. Controlled by{" "}
                    <code>useLoadingState</code> →{" "}
                    <code>showImageGenProgress</code>. Shown independently of{" "}
                    <code>showToolProgress</code> so both can appear
                    simultaneously if the model runs search + image gen in
                    parallel.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Streaming caret ─── */}
                <AssistantShell>
                  <div className="text-foreground flex items-baseline gap-1 text-sm">
                    <span>Sample text trailing</span>
                    <StreamingCaret
                      visible={true}
                      variant={STREAMING_INDICATOR_VARIANT}
                      className="-mt-1 ml-px"
                    />
                  </div>
                  <StateAnnotation title="StreamingCaret — content trailing indicator">
                    Rendered after the <code>&lt;MessageContent&gt;</code> block
                    while content is actively streaming. Managed by a 3-phase
                    state machine in <code>message-assistant.tsx</code>:
                    <code>&quot;hidden&quot;</code> →{" "}
                    <code>&quot;visible&quot;</code> (during stream) →{" "}
                    <code>&quot;fading&quot;</code> (300ms fade-out after stream
                    ends) → <code>&quot;hidden&quot;</code>. The variant (
                    <code>&quot;caret&quot;</code>) is set by{" "}
                    <code>STREAMING_INDICATOR_VARIANT</code>. Seven variants
                    available: caret, rotating-glyph, wave-segment,
                    slide-dot-trail, pulse-dot, shimmer-underscore,
                    soft-glow-marker.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── System message ─── */}
                <AssistantShell>
                  <SystemMessage
                    variant="warning"
                    fill
                    cta={{ label: "Regenerate", onClick: noop }}
                  >
                    Response may be incomplete due to output length limits.
                  </SystemMessage>
                  <StateAnnotation title="SystemMessage — response truncated (warning)">
                    Shown when <code>finishReason === &quot;length&quot;</code>{" "}
                    and <code>status !== &quot;streaming&quot;</code>. Indicates
                    the model hit its max output token limit before completing
                    its response. The &quot;Regenerate&quot; CTA calls{" "}
                    <code>onReload</code>. Only shown on the last message in the
                    conversation. Rendered at the end of the assistant message,
                    above the action buttons.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Sources & Citations ─── */}
                <AssistantShell>
                  <SourcesList sources={MOCK_SOURCES} />
                  <StateAnnotation title="SourcesList — citation display">
                    Rendered in <code>message-assistant.tsx</code> when
                    <code>getSources(parts)</code> returns a non-empty array.
                    Sources come from <code>source-url</code> parts (native AI
                    SDK citations) or from tool outputs like{" "}
                    <code>summarizeSources</code>. The collapsed view shows
                    &quot;Sources&quot; with stacked favicons; clicking expands
                    to a list of linked titles with formatted URLs. Favicons
                    load from Google&apos;s favicon service with graceful
                    fallback on error. Uses
                    <code>motion/react</code> for spring-based expand/collapse
                    animation.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Error & System States ─── */}
                <AssistantShell>
                  <SystemMessage variant="error" fill>
                    An error occurred while generating the response. Please try
                    again.
                  </SystemMessage>
                  <StateAnnotation title="SystemMessage — error">
                    The error variant uses red styling with an
                    <code>AlertCircleIcon</code>. Not currently triggered by
                    <code>message-assistant.tsx</code> inline — errors are
                    typically handled by the <code>onError</code> callback in{" "}
                    <code>useChat</code> and shown via toast. This variant is
                    available for custom error rendering in future features
                    (e.g., content policy violations, provider outages). The
                    <code>fill</code> prop adds a subtle background tint.
                  </StateAnnotation>
                </AssistantShell>

                <AssistantShell>
                  <SystemMessage
                    variant="action"
                    fill
                    cta={{ label: "Learn more", onClick: noop }}
                  >
                    This model requires a BYOK API key to use.
                  </SystemMessage>
                  <StateAnnotation title="SystemMessage — action (informational)">
                    The action variant uses neutral zinc styling with an
                    <code>InformationCircleIcon</code>. Suitable for non-error
                    notifications like model switches, feature gates, or
                    informational messages. The optional <code>cta</code> prop
                    adds a button. Three variants available: <code>action</code>
                    , <code>warning</code>, <code>error</code>. Each has
                    <code>fill</code>/<code>no-fill</code> compound variants for
                    background + border styling defined via <code>cva</code> in{" "}
                    <code>system-message.tsx</code>.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── ThinkingBar: navigable variant ─── */}
                <AssistantShell>
                  <ThinkingBar text="Thinking" onClick={noop} />
                  <StateAnnotation title="ThinkingBar — with onClick (navigable)">
                    When the <code>onClick</code> prop is provided, the shimmer
                    text becomes a<code>&lt;button&gt;</code> with an{" "}
                    <code>ArrowRight01Icon</code> arrow. Used in compact preview
                    surfaces where clicking navigates to the full response.
                    Without <code>onClick</code>, it renders as a
                    non-interactive span (the submitted-state version shown
                    above). The <code>onStop</code>
                    prop is accepted for API compatibility but currently unused
                    in the UI (stop CTA was removed pending UX review).
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Remaining Loader Variants ─── */}
                <AssistantShell>
                  <div className="flex flex-wrap items-end gap-6">
                    {LOADER_VARIANTS.map(({ variant, label }) => (
                      <div
                        key={variant}
                        className="flex flex-col items-center gap-2"
                      >
                        <Loader variant={variant} text="Loading" />
                        <span className="text-muted-foreground text-xs">
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <StateAnnotation title="Loader — all remaining variants (11 of 13)">
                    The unified <code>Loader</code> component in
                    <code>components/ui/loader.tsx</code> supports 13 total
                    variants. The test page above shows{" "}
                    <code>text-shimmer</code> and
                    <code>loading-dots</code> in context. Here are the other 11:
                    <code>circular</code> (CSS border spinner),{" "}
                    <code>classic</code> (12-bar radial), <code>pulse</code>{" "}
                    (ring pulse), <code>pulse-dot</code> (single pulsing dot),{" "}
                    <code>dots</code> (3-dot bounce), <code>typing</code> (3-dot
                    fade), <code>wave</code> (5-bar equalizer),{" "}
                    <code>bars</code> (3-bar stretch),
                    <code>terminal</code> (cursor blink),{" "}
                    <code>text-blink</code> (fading text), and <code>chat</code>{" "}
                    (Framer Motion 3-dot bounce — the original prompt-kit
                    loader). All accept <code>size</code> (sm/md/lg) and
                    optional
                    <code>text</code>/<code>className</code>.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── StreamingCaret Variants ─── */}
                <AssistantShell>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-end gap-6">
                      {STREAMING_CARET_VARIANTS.map((variant) => (
                        <div
                          key={variant}
                          className="flex flex-col items-center gap-2"
                        >
                          <div className="text-foreground flex items-baseline gap-1 text-sm">
                            <span>Text</span>
                            <StreamingCaret
                              visible
                              variant={variant}
                              className="-mt-1 ml-px"
                            />
                          </div>
                          <span className="text-muted-foreground text-xs">
                            {variant}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col items-start gap-2">
                      <div className="text-foreground flex items-baseline gap-1 text-sm">
                        <span>Fading out</span>
                        <StreamingCaret
                          visible={false}
                          variant="caret"
                          className="-mt-1 ml-px"
                        />
                      </div>
                      <span className="text-muted-foreground text-xs">
                        caret (fading)
                      </span>
                    </div>
                  </div>
                  <StateAnnotation title="StreamingCaret — all remaining variants + fading state">
                    The <code>StreamingCaret</code> component supports 7 visual
                    variants plus a <code>&quot;none&quot;</code> option. The{" "}
                    <code>caret</code> variant is shown in context above. Here
                    are the other 6: <code>rotating-glyph</code> (spinning ◜),
                    <code>wave-segment</code> (3-bar wave),{" "}
                    <code>slide-dot-trail</code> (3-dot trail),{" "}
                    <code>pulse-dot</code> (pulsing circle),
                    <code>shimmer-underscore</code> (gradient line), and
                    <code>soft-glow-marker</code> (glowing cursor). The fading
                    state demonstrates <code>visible=false</code> which triggers
                    a 300ms
                    <code>caret-fade-out</code> CSS animation;{" "}
                    <code>onFadeOutComplete</code> fires when the animation ends
                    so <code>message-assistant.tsx</code> can transition from{" "}
                    <code>&quot;fading&quot;</code> →{" "}
                    <code>&quot;hidden&quot;</code>.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── Onboarding / Empty State ─── */}
                <AssistantShell>
                  <h1 className="mb-6 text-3xl font-medium tracking-tight text-balance">
                    What&apos;s on your mind?
                  </h1>
                  <StateAnnotation title="Onboarding — empty state heading">
                    Rendered by <code>chat.tsx</code> when{" "}
                    <code>showOnboarding</code> is true (
                    <code>!chatId && messages.length === 0</code>). The heading
                    sits above the composer in the center of the viewport.
                    Wrapped in
                    <code>motion.div</code> with <code>AnimatePresence</code>{" "}
                    for enter/exit transitions and{" "}
                    <code>layout=&quot;position&quot;</code> for smooth
                    repositioning when the first message is sent. Below this
                    heading, the
                    <code>Suggestions</code> component renders a grid of
                    category pills (from <code>lib/config.ts SUGGESTIONS</code>)
                    when
                    <code>preferences.promptSuggestions</code> is enabled.
                  </StateAnnotation>
                </AssistantShell>

                {/* ─── User message ─── */}
                <UserBubble>Now show me all markdown formatting</UserBubble>

                {/* ─── Assistant: comprehensive markdown ─── */}
                <AssistantShell isLast>
                  <Reasoning
                    isStreaming={false}
                    phase="complete"
                    durationSeconds={7}
                    opaque={false}
                  >
                    <ReasoningLabel />
                    <ReasoningContent markdown>
                      The user wants to see a comprehensive markdown demo. I
                      should include headings, lists, code blocks, tables,
                      blockquotes, inline formatting, and math.
                    </ReasoningContent>
                  </Reasoning>

                  <MessageContent className={PROSE_CLASSES} markdown={true}>
                    {MARKDOWN_RESPONSE}
                  </MessageContent>

                  <CopyRegenActions />
                </AssistantShell>
                <ThreadScrollEdge
                  chatId={null}
                  streamActive={threadLifecycle.streamActive}
                  pinTurnId={null}
                  hydrated
                  freshChat
                />
              </>
            )}
          </div>

          {/* ━━━ Composer ━━━ */}
          <ThreadBottomContainer
            ref={threadBottomRef}
            isOnboarding={threadSurface.isOnboarding}
          >
            <TurnContextProvider chatId={null} currentChat={null}>
              <Composer
                chatId={null}
                draftScopeId={threadSurface.draftScopeId}
                placeholder={threadSurface.placeholder}
                ariaLabel={threadSurface.placeholder}
                bottomSpacing="none"
                onTurn={() => false}
                isSubmitting={false}
                status={threadLifecycle.status}
                stop={noop}
                stoppable={threadLifecycle.stoppable}
                hasSuggestions={false}
              />
            </TurnContextProvider>
          </ThreadBottomContainer>
        </div>
      </LayoutApp>
    </MessagesProvider>
  )
}

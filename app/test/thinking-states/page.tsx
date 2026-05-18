"use client"
import { RiFileCopyLine, RiRefreshLine } from "@remixicon/react"

import { ChatInput } from "@/app/components/chat-input/chat-input"
import { SourcesList } from "@/app/components/chat/sources-list"
import { ToolInvocation } from "@/app/components/chat/tool-invocation"
import { LayoutApp } from "@/app/components/layout/layout-app"
import { MessagesProvider } from "@/lib/chat-store/messages/provider"
import { ScrollRootContent } from "@/components/ui/scroll-root"
import { ScrollButton } from "@/components/ui/scroll-button"
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
import { SystemMessage } from "@/components/ui/system-message"
import { ThinkingBar } from "@/components/ui/thinking-bar"
import { cn } from "@/lib/utils"
import type { SourceUrlUIPart, ToolUIPart } from "ai"
import { useCallback, useState, useEffect, useId } from "react"

// ─── Constants ───────────────────────────────────────────────────────────────

const STREAMING_INDICATOR_VARIANT: StreamingIndicatorVariant = "caret"

const PROSE_CLASSES =
  "prose relative min-w-full bg-transparent p-0 prose-h1:scroll-m-20 prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:scroll-m-20 prose-h2:text-xl prose-h2:mb-3 prose-h2:font-medium prose-h3:scroll-m-20 prose-h3:text-base prose-h3:font-medium prose-h4:scroll-m-20 prose-h5:scroll-m-20 prose-h6:scroll-m-20 prose-strong:font-medium prose-table:block prose-table:overflow-y-auto"

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

const MOCK_TOOL_RUNNING = {
  type: "tool-web_search",
  toolCallId: "call_search_001",
  state: "input-available",
  input: { query: "quantum computing recent advances 2025" },
} as unknown as ToolUIPart

const MOCK_TOOL_COMPLETED = {
  type: "tool-web_search",
  toolCallId: "call_search_002",
  state: "output-available",
  input: { query: "quantum computing recent advances 2025" },
  output: [
    {
      url: "https://example.com/quantum-computing",
      title: "Advances in Quantum Computing",
      snippet:
        "Recent breakthroughs in quantum error correction have brought us closer to fault-tolerant quantum computation.",
    },
    {
      url: "https://arxiv.org/abs/2401.12345",
      title: "Topological Quantum Error Correction",
      snippet:
        "A novel approach to fault-tolerant quantum computation using topological qubits.",
    },
    {
      url: "https://nature.com/articles/quantum-2025",
      title: "Nature: Quantum Computing Review 2025",
      snippet:
        "A comprehensive review of progress in quantum computing hardware and algorithms.",
    },
  ],
} as unknown as ToolUIPart

const MOCK_TOOL_GENERIC = {
  type: "tool-my_github_server_create_issue",
  toolCallId: "call_github_003",
  state: "output-available",
  input: {
    title: "Fix quantum entanglement module",
    body: "The entanglement fidelity drops below threshold under load.",
    labels: ["bug", "quantum"],
  },
  output: {
    title: "Issue #42 created",
    html_url: "https://github.com/example/quantum-repo/issues/42",
  },
} as unknown as ToolUIPart

const MOCK_MULTI_TOOLS = [MOCK_TOOL_COMPLETED, MOCK_TOOL_GENERIC]

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
      <div className="text-foreground/70 text-[14px] font-semibold leading-snug">
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
        "text-base mx-auto w-full [--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem] px-[var(--thread-content-margin,1rem)]",
        role === "user" && "pt-3 scroll-mt-[var(--spacing-app-header)]",
        role === "assistant" && "pb-10 scroll-mt-[calc(var(--spacing-app-header)+min(200px,max(70px,20svh)))]"
      )}
      data-turn={role}
    >
      <div className="group/turn-messages relative mx-auto flex w-full min-w-0 [--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem] max-w-[var(--thread-content-max-width,40rem)] flex-1 flex-col">
        {children}
      </div>
    </article>
  )
}

function UserBubble({ children }: { children: string }) {
  const isMultiline = children.includes("\n")
  return (
    <ArticleWrapper role="user">
      <Message
        className="flex w-full flex-col items-end gap-0.5"
        data-turn="user"
        data-scroll-anchor="false"
        tabIndex={-1}
      >
        <h5 className="sr-only">You said:</h5>
        <MessageContent
          className={cn(
            "bg-accent prose relative max-w-[var(--user-chat-width,70%)] rounded-[18px] px-4",
            isMultiline ? "py-3" : "py-1.5"
          )}
          markdown={false}
        >
          {children}
        </MessageContent>
      </Message>
    </ArticleWrapper>
  )
}

function AssistantShell({
  children,
  isLast = false,
}: {
  children: React.ReactNode
  isLast?: boolean
}) {
  const msgId = useId()
  return (
    <ArticleWrapper role="assistant">
      <Message
        className="flex w-full flex-1 items-start gap-4"
        data-turn="assistant"
        data-message-id={msgId}
        data-scroll-anchor={isLast ? "true" : "false"}
        tabIndex={-1}
      >
        <h6 className="sr-only">Assistant said:</h6>
        <div
          className={cn(
            "relative flex min-w-full flex-col gap-2",
            isLast && "pb-8"
          )}
        >
          {children}
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
      <MessageAction tooltip="Copy text" side="bottom">
        <button
          className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Copy text"
          type="button"
        >
          <RiFileCopyLine size={20} className="size-5" />
        </button>
      </MessageAction>
      <MessageAction tooltip="Regenerate" side="bottom" delay={0}>
        <button
          className="hover:bg-accent/60 text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg bg-transparent transition pointer-coarse:h-10 pointer-coarse:w-10"
          aria-label="Regenerate"
          type="button"
        >
          <RiRefreshLine size={20} className="size-5" />
        </button>
      </MessageAction>
    </MessageActions>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ThinkingStatesTestPage() {
  const liveSeconds = useLiveTimer()

  const noop = useCallback(() => {}, [])
  const noopStr = useCallback((_s: string) => {}, [])
  const noopBool = useCallback((_b: boolean) => {}, [])
  const noopFiles = useCallback((_f: File[]) => {}, [])
  const noopFile = useCallback((_f: File) => {}, [])

  return (
    <MessagesProvider>
    <LayoutApp>
      <div className="relative flex min-h-0 flex-1 flex-col items-center">
        {/* ━━━ Conversation ━━━ */}
        <ScrollRootContent className="relative flex w-full flex-1 flex-col items-center pt-4 [--composer-overlap-px:28px] [--thread-bottom-offset:calc(var(--spacing-input-area)+2rem+env(safe-area-inset-bottom,0px))] pb-[var(--thread-bottom-offset)] -mb-[var(--composer-overlap-px)]">
              {/* ─── User message ─── */}
              <UserBubble>This is a test chat thread</UserBubble>

              {/* ─── Submitted state: ThinkingBar ─── */}
              <AssistantShell>
                <ThinkingBar text="Thinking" />
                <StateAnnotation title="ThinkingBar — status: submitted">
                  Appears immediately after the user sends a message, before the
                  API stream begins. Triggered when <code>status === &quot;submitted&quot;</code> and
                  the last message is from the user. Rendered by <code>conversation.tsx</code> outside
                  the message list. Disappears once the first streaming chunk arrives
                  and status transitions to <code>&quot;streaming&quot;</code>.
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
                  Active when reasoning parts are streaming (<code>part.state === &quot;streaming&quot;</code>).
                  The shimmer &quot;Thinking&quot; label + live timer tick every second. Content
                  auto-expands while streaming. Used by models like Claude 3.5/4 that
                  share their chain-of-thought. Derived by <code>useReasoningPhase</code> from
                  the <code>parts</code> array in <code>message-assistant.tsx</code>.
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
                  Same thinking phase, but the model doesn&apos;t expose its reasoning
                  text (e.g., OpenAI o1/o3). <code>isOpaqueReasoning</code> is true when reasoning
                  parts exist but have no visible text. Shows the shimmer label + timer
                  but no toggle chevron and no expandable content. The <code>opaque</code> prop
                  forces <code>isOpen</code> to false in the Reasoning context.
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
                  After reasoning finishes (<code>part.state === &quot;done&quot;</code> or <code>status === &quot;ready&quot;</code>),
                  phase transitions to <code>&quot;complete&quot;</code>. The label changes to
                  &quot;Thought for Xs&quot; using the frozen timer value or persisted <code>metadata.reasoningDurationMs</code>.
                  Content auto-collapses when streaming ends. User can click
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
                  Fallback when <code>durationSeconds</code> is undefined — either the timer
                  never ticked (non-last message loaded from history) or
                  <code>metadata.reasoningDurationMs</code> wasn&apos;t persisted. The label
                  shows &quot;Reasoned&quot; without a time. Same toggle behavior.
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
                  Shows &quot;Thought for 8s&quot; but no chevron or expandable content.
                  Rendered as a static <code>&lt;div&gt;</code> instead of a <code>&lt;button&gt;</code> since
                  there&apos;s nothing to toggle.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── Loader states ─── */}
              <AssistantShell>
                <Loader
                  variant="text-shimmer"
                  text="Thinking"
                  showCaret
                  streamingIndicatorVariant={STREAMING_INDICATOR_VARIANT}
                />
                <StateAnnotation title='Loader — "Generating" (text-shimmer + caret)'>
                  Shown when <code>status === &quot;streaming&quot;</code>, <code>isLast</code> is true, content
                  is still empty, and there&apos;s no visible reasoning or tool output.
                  Controlled by <code>useLoadingState</code> → <code>showDots</code>. Disappears as soon as the
                  first text part arrives. The caret variant is set
                  by <code>STREAMING_INDICATOR_VARIANT</code> in <code>message-assistant.tsx</code>.
                </StateAnnotation>
              </AssistantShell>

              <AssistantShell>
                <Loader variant="loading-dots" text="Searching the web" />
                <StateAnnotation title='Loader — "Searching the web" (loading-dots)'>
                  Appears when a single tool invocation is in progress (<code>state !== &quot;output-available&quot;</code>)
                  and the tool name matches <code>web_search</code> or <code>google_search</code>.
                  Controlled by <code>useLoadingState</code> → <code>showToolProgress</code>. The label is
                  formatted by <code>formatToolProgressLabel()</code> in <code>message-assistant.tsx</code>.
                </StateAnnotation>
              </AssistantShell>

              <AssistantShell>
                <Loader variant="loading-dots" text="Running tools" />
                <StateAnnotation title='Loader — "Running tools" (loading-dots)'>
                  Same as above but when multiple tools are active simultaneously
                  (<code>activeToolNames.length &gt; 1</code>). The generic &quot;Running tools&quot; label
                  replaces the specific tool name. Common during multi-step
                  agent workflows.
                </StateAnnotation>
              </AssistantShell>

              <AssistantShell>
                <Loader variant="loading-dots" text="Generating image" />
                <StateAnnotation title='Loader — "Generating image" (loading-dots)'>
                  Triggered when any in-progress tool part has the name <code>imageGeneration</code> or
                  <code>image_generation</code>. Controlled by <code>useLoadingState</code> → <code>showImageGenProgress</code>.
                  Shown independently of <code>showToolProgress</code> so both can appear simultaneously
                  if the model runs search + image gen in parallel.
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
                  Rendered after the <code>&lt;MessageContent&gt;</code> block while content is actively
                  streaming. Managed by a 3-phase state machine in <code>message-assistant.tsx</code>:
                  <code>&quot;hidden&quot;</code> → <code>&quot;visible&quot;</code> (during stream) → <code>&quot;fading&quot;</code> (300ms
                  fade-out after stream ends) → <code>&quot;hidden&quot;</code>. The variant (<code>&quot;caret&quot;</code>) is
                  set by <code>STREAMING_INDICATOR_VARIANT</code>. Seven variants available:
                  caret, rotating-glyph, wave-segment, slide-dot-trail,
                  pulse-dot, shimmer-underscore, soft-glow-marker.
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
                  Shown when <code>finishReason === &quot;length&quot;</code> and <code>status !== &quot;streaming&quot;</code>.
                  Indicates the model hit its max output token limit before
                  completing its response. The &quot;Regenerate&quot; CTA calls <code>onReload</code>.
                  Only shown on the last message in the conversation. Rendered
                  at the end of the assistant message, above the action buttons.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── Tool Invocations ─── */}
              <AssistantShell>
                <ToolInvocation toolInvocations={[MOCK_TOOL_RUNNING]} />
                <StateAnnotation title="ToolInvocation — single tool, running">
                  Shown when a tool part has <code>state === &quot;input-available&quot;</code> (or
                  <code>&quot;input-streaming&quot;</code> for partial args). The card displays a
                  &quot;Running&quot; badge with a spinner, the tool name resolved by
                  <code>getStaticToolName()</code> from the <code>type</code> field (e.g.,
                  <code>tool-web_search</code> → <code>Web Search</code>), and the input arguments.
                  Rendered by <code>tool-invocation.tsx</code> → <code>SingleToolCard</code>.
                  Expandable to show the arguments section. Built-in tool names
                  (web_search, google_search) get human-readable display names
                  and icons via <code>BUILTIN_TOOL_DISPLAY</code>.
                </StateAnnotation>
              </AssistantShell>

              <AssistantShell>
                <ToolInvocation
                  toolInvocations={[MOCK_TOOL_COMPLETED]}
                  defaultOpen
                />
                <StateAnnotation title="ToolInvocation — single tool, completed (expanded)">
                  When <code>state === &quot;output-available&quot;</code>, the badge transitions to a green
                  &quot;Completed&quot; pill via <code>AnimatePresence</code> with a blur/scale morph.
                  The result section appears below the arguments. Search results
                  (arrays with <code>url</code>/<code>title</code>/<code>snippet</code>) get rich link
                  formatting; other results fall back to JSON. <code>defaultOpen</code> starts
                  the card expanded. Rendered conditionally by
                  <code>message-assistant.tsx</code> only when
                  <code>preferences.showToolInvocations</code> is true.
                </StateAnnotation>
              </AssistantShell>

              <AssistantShell>
                <ToolInvocation toolInvocations={MOCK_MULTI_TOOLS} />
                <StateAnnotation title="ToolInvocation — multi-tool group">
                  When multiple tool invocations have different <code>toolCallId</code>s,
                  <code>ToolInvocation</code> renders a grouped container with a &quot;Tools
                  executed&quot; header, a count badge, and a collapsible list of
                  individual tool cards. Each card inside uses <code>SingleToolView</code>.
                  Common during multi-step agent workflows where the model calls
                  web_search + code_execution + custom tools in parallel.
                  MCP tool names appear namespaced (e.g.,
                  <code>my_github_server_create_issue</code>) and display in monospace.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── Sources & Citations ─── */}
              <AssistantShell>
                <SourcesList sources={MOCK_SOURCES} />
                <StateAnnotation title="SourcesList — citation display">
                  Rendered in <code>message-assistant.tsx</code> when
                  <code>getSources(parts)</code> returns a non-empty array. Sources come
                  from <code>source-url</code> parts (native AI SDK citations) or from tool
                  outputs like <code>summarizeSources</code>. The collapsed view shows
                  &quot;Sources&quot; with stacked favicons; clicking expands to a list of
                  linked titles with formatted URLs. Favicons load from Google&apos;s
                  favicon service with graceful fallback on error. Uses
                  <code>motion/react</code> for spring-based expand/collapse animation.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── Error & System States ─── */}
              <AssistantShell>
                <SystemMessage variant="error" fill>
                  An error occurred while generating the response. Please try again.
                </SystemMessage>
                <StateAnnotation title="SystemMessage — error">
                  The error variant uses red styling with an
                  <code>AlertCircleIcon</code>. Not currently triggered by
                  <code>message-assistant.tsx</code> inline — errors are typically handled
                  by the <code>onError</code> callback in <code>useChat</code> and shown via toast.
                  This variant is available for custom error rendering in future
                  features (e.g., content policy violations, provider outages). The
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
                  <code>InformationCircleIcon</code>. Suitable for non-error notifications
                  like model switches, feature gates, or informational messages.
                  The optional <code>cta</code> prop adds a button. Three variants
                  available: <code>action</code>, <code>warning</code>, <code>error</code>. Each has
                  <code>fill</code>/<code>no-fill</code> compound variants for background + border
                  styling defined via <code>cva</code> in <code>system-message.tsx</code>.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── ThinkingBar: navigable variant ─── */}
              <AssistantShell>
                <ThinkingBar text="Thinking" onClick={noop} />
                <StateAnnotation title="ThinkingBar — with onClick (navigable)">
                  When the <code>onClick</code> prop is provided, the shimmer text becomes a
                  <code>&lt;button&gt;</code> with an <code>ArrowRight01Icon</code> arrow. Used in
                  compact preview surfaces where clicking navigates to the full
                  response. Without <code>onClick</code>, it renders as a non-interactive
                  span (the submitted-state version shown above). The <code>onStop</code>
                  prop is accepted for API compatibility but currently unused in
                  the UI (stop CTA was removed pending UX review).
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
                  <code>components/ui/loader.tsx</code> supports 13 total variants. The
                  test page above shows <code>text-shimmer</code> and
                  <code>loading-dots</code> in context. Here are the other 11:
                  <code>circular</code> (CSS border spinner), <code>classic</code> (12-bar
                  radial), <code>pulse</code> (ring pulse), <code>pulse-dot</code> (single
                  pulsing dot), <code>dots</code> (3-dot bounce), <code>typing</code> (3-dot
                  fade), <code>wave</code> (5-bar equalizer), <code>bars</code> (3-bar stretch),
                  <code>terminal</code> (cursor blink), <code>text-blink</code> (fading text),
                  and <code>chat</code> (Framer Motion 3-dot bounce — the original
                  prompt-kit loader). All accept <code>size</code> (sm/md/lg) and optional
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
                  The <code>StreamingCaret</code> component supports 7 visual variants plus
                  a <code>&quot;none&quot;</code> option. The <code>caret</code> variant is shown in context
                  above. Here are the other 6: <code>rotating-glyph</code> (spinning ◜),
                  <code>wave-segment</code> (3-bar wave), <code>slide-dot-trail</code> (3-dot
                  trail), <code>pulse-dot</code> (pulsing circle),
                  <code>shimmer-underscore</code> (gradient line), and
                  <code>soft-glow-marker</code> (glowing cursor). The fading state
                  demonstrates <code>visible=false</code> which triggers a 300ms
                  <code>caret-fade-out</code> CSS animation; <code>onFadeOutComplete</code> fires
                  when the animation ends so <code>message-assistant.tsx</code> can
                  transition from <code>&quot;fading&quot;</code> → <code>&quot;hidden&quot;</code>.
                </StateAnnotation>
              </AssistantShell>

              {/* ─── Onboarding / Empty State ─── */}
              <AssistantShell>
                <h1 className="mb-6 text-3xl font-medium tracking-tight text-balance">
                  What&apos;s on your mind?
                </h1>
                <StateAnnotation title="Onboarding — empty state heading">
                  Rendered by <code>chat.tsx</code> when <code>showOnboarding</code> is true
                  (<code>!chatId && messages.length === 0</code>). The heading sits above
                  the composer in the center of the viewport. Wrapped in
                  <code>motion.div</code> with <code>AnimatePresence</code> for enter/exit
                  transitions and <code>layout=&quot;position&quot;</code> for smooth repositioning
                  when the first message is sent. Below this heading, the
                  <code>Suggestions</code> component renders a grid of category pills
                  (from <code>lib/config.ts SUGGESTIONS</code>) when
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
                    The user wants to see a comprehensive markdown demo. I should
                    include headings, lists, code blocks, tables, blockquotes,
                    inline formatting, and math.
                  </ReasoningContent>
                </Reasoning>

                <MessageContent className={PROSE_CLASSES} markdown={true}>
                  {MARKDOWN_RESPONSE}
                </MessageContent>

                <CopyRegenActions />
              </AssistantShell>
        </ScrollRootContent>

        {/* ━━━ Composer ━━━ */}
        <div className="group/thread-bottom-container content-fade relative isolate z-10 flex w-full basis-auto flex-col [--thread-content-margin:1rem] @sm/main:[--thread-content-margin:1.5rem] @lg/main:[--thread-content-margin:4rem] px-[var(--thread-content-margin,1rem)] pb-[env(safe-area-inset-bottom,0px)] sticky bottom-0">
          <div className="relative h-0">
            <div className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+1.5rem)] z-30 flex justify-center">
              <div className="pointer-events-auto">
                <ScrollButton />
              </div>
            </div>
          </div>
          <div className="mx-auto w-full [--thread-content-max-width:40rem] @[64rem]/main:[--thread-content-max-width:48rem] max-w-[var(--thread-content-max-width,40rem)]">
            <ChatInput
              defaultValue=""
              onValueChange={noopStr}
              onSend={noop}
              isSubmitting={false}
              files={[]}
              onFileUpload={noopFiles}
              onFileRemove={noopFile}
              onSuggestion={noopStr}
              hasSuggestions={false}
              selectedModel="gpt-5.4"
              isUserAuthenticated={true}
              stop={noop}
              status="ready"
              setEnableSearch={noopBool}
              enableSearch={false}
            />
          </div>
          <div className="-mt-4 text-muted-foreground relative w-full overflow-hidden text-center text-xs md:px-[60px]">
            <div className="flex min-h-8 w-full items-center justify-center p-2 select-none">
              <div className="pointer-events-auto">
                <div>Not A Wrapper can make mistakes. Check important info.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LayoutApp>
    </MessagesProvider>
  )
}

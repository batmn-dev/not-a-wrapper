import type { AssistantActivityModel } from "@/lib/chat-messages/assistant-activity"
import type { AssistantSourceResult } from "@/lib/chat-messages/sources"

const ACTIVITY_SOURCES = [
  {
    type: "source-url",
    sourceId: "fixture-source-1",
    url: "https://developer.mozilla.org/en-US/docs/Web/Accessibility",
    title: "Accessibility on the web",
    siteName: "developer.mozilla.org",
    description:
      "Accessibility makes websites usable by as many people as possible, including people with disabilities.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-2",
    url: "https://react.dev/reference/react",
    title: "React reference",
    siteName: "react.dev",
    description:
      "Reference documentation for React APIs, components, hooks, and browser integration.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-3",
    url: "https://www.w3.org/WAI/ARIA/apg/",
    title: "ARIA Authoring Practices Guide",
    siteName: "www.w3.org",
    description:
      "Patterns and keyboard interaction guidance for accessible web application widgets.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-4",
    url: "https://web.dev/learn/accessibility",
    title: "Learn accessibility",
    siteName: "web.dev",
    description:
      "A practical course covering focus, semantics, assistive technology, and accessible interfaces.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-5",
    url: "https://testing-library.com/docs/queries/about/",
    title: "Testing Library queries",
    siteName: "testing-library.com",
    description:
      "Guidance for selecting elements with queries that reflect how people use the interface.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-6",
    url: "https://www.w3.org/WAI/WCAG22/quickref/",
    title: "How to Meet WCAG",
    siteName: "www.w3.org",
    description:
      "A customizable quick reference to Web Content Accessibility Guidelines requirements and techniques.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-7",
    url: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion",
    title: "prefers-reduced-motion",
    siteName: "developer.mozilla.org",
    description:
      "The media feature detects whether a person has requested less non-essential motion.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-8",
    url: "https://web.dev/articles/accessible-tap-targets",
    title: "Accessible tap targets",
    siteName: "web.dev",
    description:
      "Guidance for sizing and spacing interactive controls so they are easier to activate.",
  },
] satisfies AssistantSourceResult[]

const SECOND_SEARCH_SOURCES = [
  {
    type: "source-url",
    sourceId: "fixture-source-9",
    url: "https://react.dev/learn/accessibility",
    title: "Accessible React interfaces",
    siteName: "react.dev",
    description: "Semantic interaction patterns for React applications.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-10",
    url: "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-expanded",
    title: "ARIA expanded state",
    siteName: "developer.mozilla.org",
    description: "How disclosure controls expose expanded and collapsed state.",
  },
  {
    type: "source-url",
    sourceId: "fixture-source-11",
    url: "https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html",
    title: "Focus visible",
    siteName: "www.w3.org",
    description: "Requirements for a visible keyboard focus indicator.",
  },
] satisfies AssistantSourceResult[]

const COMPLETED_ACTIVITY = {
  entries: [
    {
      id: "fixture-reasoning",
      kind: "reasoning",
      title: "Planning the interface audit",
      detail: "I’ll inspect layout, interaction, and accessibility as one run.",
      status: "complete",
    },
    {
      id: "fixture-tool",
      kind: "tool",
      title: "Checking the Activity panel tests",
      status: "complete",
      tool: {
        toolName: "python",
        displayName: "Python",
        code: "python -m pytest tests/activity_panel.py -q",
      },
    },
    {
      id: "fixture-search",
      kind: "search",
      title: "Searching for accessible activity timeline patterns",
      status: "complete",
      sources: ACTIVITY_SOURCES,
    },
    {
      id: "fixture-reasoning-interleaved",
      kind: "reasoning",
      title: "Comparing source interactions",
      detail: "I’m checking expansion, wrapping, and keyboard behavior.",
      status: "complete",
    },
    {
      id: "fixture-search-secondary",
      kind: "search",
      title: "Searching for disclosure accessibility guidance",
      status: "complete",
      sources: SECOND_SEARCH_SOURCES,
    },
    {
      id: "completion",
      kind: "completion",
      title: "Worked for 42s",
      detail: "Done",
      status: "complete",
    },
  ],
  sourceResults: [...ACTIVITY_SOURCES, ...SECOND_SEARCH_SOURCES],
  imageResults: [],
} satisfies AssistantActivityModel

const RUNNING_ACTIVITY = {
  entries: [
    {
      id: "fixture-reasoning-complete",
      kind: "reasoning",
      title: "Planning the interface audit",
      detail: "The layout and accessibility pass is ready.",
      status: "complete",
    },
    {
      id: "fixture-tool-running",
      kind: "tool",
      title: "Checking the Activity panel tests",
      status: "running",
      tool: {
        toolName: "python",
        displayName: "Python",
        code: "python -m pytest tests/activity_panel.py -q",
      },
    },
  ],
  sourceResults: [],
  imageResults: [],
} satisfies AssistantActivityModel

const APPROVAL_ACTIVITY = {
  entries: [
    {
      id: "fixture-approval",
      kind: "tool",
      title: "Delete preview artifact",
      detail: "Approval required before this tool can run.",
      status: "approval",
      tool: {
        toolName: "delete_file",
        displayName: "Delete File",
        code: '{\n  "path": "/tmp/activity-preview.png"\n}',
        approvalId: "fixture-approval-1",
      },
    },
  ],
  sourceResults: [],
  imageResults: [],
} satisfies AssistantActivityModel

const ERROR_ACTIVITY = {
  entries: [
    {
      id: "fixture-error",
      kind: "tool",
      title: "Publish preview",
      detail: "Preview service returned an error.",
      status: "error",
      tool: {
        toolName: "publish_preview",
        displayName: "Publish Preview",
        code: '{\n  "target": "fixture"\n}',
      },
    },
    {
      id: "completion",
      kind: "completion",
      title: "Run failed",
      detail: "Error",
      status: "error",
    },
  ],
  sourceResults: [],
  imageResults: [],
} satisfies AssistantActivityModel

const DENIED_ACTIVITY = {
  entries: [
    {
      id: "fixture-denied",
      kind: "tool",
      title: "Delete File failed",
      detail: "Approval denied by the user.",
      status: "denied",
      tool: {
        toolName: "delete_file",
        displayName: "Delete File",
        code: '{\n  "path": "/tmp/activity-preview.png"\n}',
      },
    },
    {
      id: "completion",
      kind: "completion",
      title: "Run failed",
      detail: "Error",
      status: "error",
    },
  ],
  sourceResults: [],
  imageResults: [],
} satisfies AssistantActivityModel

const STOPPED_ACTIVITY = {
  entries: [
    {
      id: "fixture-reasoning-stopped",
      kind: "reasoning",
      title: "Reviewing the implementation",
      detail: "Partial reasoning was preserved before the run stopped.",
      status: "complete",
    },
    {
      id: "fixture-tool-stopped",
      kind: "tool",
      title: "Python stopped",
      status: "stopped",
      tool: {
        toolName: "python",
        displayName: "Python",
        code: "python -m pytest tests/activity_panel.py -q",
      },
    },
    {
      id: "completion",
      kind: "completion",
      title: "Generation stopped",
      detail: "Stopped",
      status: "stopped",
    },
  ],
  sourceResults: [],
  imageResults: [],
} satisfies AssistantActivityModel

export type ActivityFixtureKey =
  | "completed"
  | "running"
  | "approval"
  | "approval-disabled"
  | "error"
  | "denied"
  | "stopped"

export type ActivityFixtureRecord = {
  label: string
  activity: AssistantActivityModel
  durationSeconds?: number
  approvalActionsEnabled: boolean
}

/** Typed, deterministic UI-only records for the complete Activity lifecycle. */
export const ACTIVITY_PANEL_FIXTURES = {
  completed: {
    label: "Completed with sources",
    activity: COMPLETED_ACTIVITY,
    durationSeconds: 42,
    approvalActionsEnabled: true,
  },
  running: {
    label: "Running tool",
    activity: RUNNING_ACTIVITY,
    durationSeconds: 9,
    approvalActionsEnabled: true,
  },
  approval: {
    label: "Approval required",
    activity: APPROVAL_ACTIVITY,
    durationSeconds: 12,
    approvalActionsEnabled: true,
  },
  "approval-disabled": {
    label: "Approval controls disabled",
    activity: APPROVAL_ACTIVITY,
    durationSeconds: 12,
    approvalActionsEnabled: false,
  },
  error: {
    label: "Tool failure",
    activity: ERROR_ACTIVITY,
    durationSeconds: 18,
    approvalActionsEnabled: true,
  },
  denied: {
    label: "Approval denied",
    activity: DENIED_ACTIVITY,
    durationSeconds: 14,
    approvalActionsEnabled: true,
  },
  stopped: {
    label: "Stopped historical run",
    activity: STOPPED_ACTIVITY,
    durationSeconds: 23,
    approvalActionsEnabled: true,
  },
} satisfies Record<ActivityFixtureKey, ActivityFixtureRecord>

export const ACTIVITY_TIMELINE_FIXTURE =
  ACTIVITY_PANEL_FIXTURES.completed.activity

export type ThreadLifecycleFixtureKey = "idle" | "streaming" | "error"
export type ThreadSurfaceFixtureKey = "existing" | "project" | "onboarding"
export type ThreadInsetFixtureKey = "none" | "safe-area" | "keyboard"

export const THREAD_LIFECYCLE_FIXTURES = {
  idle: {
    label: "Idle",
    status: "ready",
    streamActive: false,
    stoppable: false,
  },
  streaming: {
    label: "Streaming / Stop",
    status: "streaming",
    streamActive: true,
    stoppable: true,
  },
  error: {
    label: "Error seam",
    status: "error",
    streamActive: false,
    stoppable: false,
  },
} as const satisfies Record<
  ThreadLifecycleFixtureKey,
  {
    label: string
    status: "ready" | "streaming" | "error"
    streamActive: boolean
    stoppable: boolean
  }
>

export const THREAD_SURFACE_FIXTURES = {
  existing: {
    label: "Existing chat",
    isOnboarding: false,
    draftScopeId: "thinking-states-playground",
    placeholder: "Ask anything",
  },
  project: {
    label: "Project chat",
    isOnboarding: false,
    draftScopeId: "project-thinking-states-playground",
    placeholder: "New chat in Interface parity",
  },
  onboarding: {
    label: "Onboarding",
    isOnboarding: true,
    draftScopeId: "thinking-states-onboarding",
    placeholder: "Ask anything",
  },
} as const satisfies Record<
  ThreadSurfaceFixtureKey,
  {
    label: string
    isOnboarding: boolean
    draftScopeId: string
    placeholder: string
  }
>

export const THREAD_INSET_FIXTURES = {
  none: {
    label: "No inset",
    safeArea: "0px",
    keyboard: "0px",
  },
  "safe-area": {
    label: "24px safe area",
    safeArea: "24px",
    keyboard: "0px",
  },
  keyboard: {
    label: "280px keyboard",
    safeArea: "24px",
    keyboard: "280px",
  },
} as const satisfies Record<
  ThreadInsetFixtureKey,
  {
    label: string
    safeArea: string
    keyboard: string
  }
>

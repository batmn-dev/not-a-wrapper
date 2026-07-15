/** @vitest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ProjectView } from "./project-view"

const projectMocks = vi.hoisted(() => ({
  attachStagedFilesToChat: vi.fn(),
  createNewChat: vi.fn(async () => ({ id: "chat-1" })),
  onTurn: null as null | ((payload: {
    text: string
    files: File[]
    attachments: Array<{ attachmentId?: string }>
  }) => Promise<boolean>),
  push: vi.fn(),
}))

vi.mock("@/app/components/chat-input/composer", () => ({
  Composer: ({ onTurn }: { onTurn: typeof projectMocks.onTurn }) => {
    projectMocks.onTurn = onTurn
    return <div data-testid="composer" />
  },
}))
vi.mock("@/app/components/chat/turn-context", () => ({
  TurnContextProvider: ({ children }: { children: React.ReactNode }) => children,
  useTurnContext: () => ({
    getTurnSnapshot: () => ({
      selectedModel: "gpt-5-mini",
      systemPrompt: "system",
    }),
  }),
}))
vi.mock("@/app/components/layout/sidebar/project-chat-item", () => ({
  ProjectChatItem: () => null,
}))
vi.mock("@/components/ui/icon", () => ({ Icon: () => null }))
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }))
vi.mock("@/lib/chat-store/chats/provider", () => ({
  useChats: () => ({ createNewChat: projectMocks.createNewChat }),
}))
vi.mock("@/lib/chat-turn/prompt-size-policy", () => ({
  evaluatePromptSize: () => ({ ok: true }),
}))
vi.mock("@/lib/convex/use-per-user-query", () => ({
  usePerUserQuery: () => ({ data: [] }),
}))
vi.mock("@/lib/file-handling", () => ({
  attachStagedFilesToChat: projectMocks.attachStagedFilesToChat,
}))
vi.mock("motion/react", () => ({
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: projectMocks.push }),
}))

beforeAll(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

describe("Project Chat turn handoff", () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    projectMocks.onTurn = null
    vi.clearAllMocks()
  })

  it("leaves staged attachments for the Chat turn controller to bind", async () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ProjectView project={{ id: "project-1", name: "Project" }} />
      )
    })

    expect(container?.querySelector("h1")?.textContent).toBe("Project")

    let accepted = false
    await act(async () => {
      accepted =
        (await projectMocks.onTurn?.({
          text: "Project question",
          files: [],
          attachments: [{ attachmentId: "attachment-1" }],
        })) ?? false
    })

    expect(accepted).toBe(true)
    expect(projectMocks.attachStagedFilesToChat).not.toHaveBeenCalled()
    expect(projectMocks.createNewChat).toHaveBeenCalledWith({
      title: "Project question",
      model: "gpt-5-mini",
      systemPrompt: "system",
      projectId: "project-1",
    })
    expect(projectMocks.push).toHaveBeenCalledWith(
      "/c/chat-1?prompt=Project+question&autoSubmit=1&attachment=attachment-1"
    )
  })
})

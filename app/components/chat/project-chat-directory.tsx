"use client"

import { ChatActionsMenu } from "@/app/components/layout/chat-actions-menu"
import { Icon } from "@/components/ui/icon"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { convexChatToChat, type Chat } from "@/lib/chat-store/types"
import { usePerUserQuery } from "@/lib/convex/use-per-user-query"
import { cn } from "@/lib/utils"
import { RiMoreFill } from "@remixicon/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Component,
  useMemo,
  useState,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
} from "react"

export type ProjectDetailTab = "chats" | "sources"

const PROJECT_TABS: Array<{ id: ProjectDetailTab; label: string }> = [
  { id: "chats", label: "Chats" },
  { id: "sources", label: "Sources" },
]

export function formatProjectConversationDate(
  value: string,
  now = new Date()
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(date)
}

type DirectoryEntry = {
  chat: Chat
  preview: string | null
}

function ProjectConversationRow({ entry }: { entry: DirectoryEntry }) {
  const { chat, preview } = entry
  const router = useRouter()
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const title = chat.title || "Untitled chat"
  const href = `/c/${chat.id}`
  const dateValue = chat.updated_at ?? chat.created_at
  const formattedDate = dateValue
    ? formatProjectConversationDate(dateValue)
    : ""
  const actionsTrigger = (
    <button
      type="button"
      className={cn(
        "hover:text-foreground data-popup-open:text-foreground focus-visible:ring-border-strong flex h-10 w-[34px] shrink-0 items-center justify-center rounded-e-[10px] py-0 ps-1 pe-1.5 text-[var(--text-tertiary)] outline-none focus-visible:ring-2",
        isActionsOpen && "text-foreground"
      )}
      aria-label={`Open conversation options for ${title}`}
    >
      <Icon icon={RiMoreFill} slotSize={20} />
    </button>
  )

  const handleRowClick = (event: MouseEvent<HTMLLIElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        "a, button, input, select, textarea, [role='dialog'], [role='menu'], [data-prevent-default='true']"
      )
    ) {
      return
    }
    router.push(href)
  }

  return (
    <li
      className={cn(
        "group/project-conversation hover:bg-interactive-hover active:bg-interactive-pressed flex min-h-16 cursor-pointer items-center p-3 text-sm select-none",
        isActionsOpen && "bg-interactive-hover"
      )}
      data-actions-open={isActionsOpen ? "true" : undefined}
      onClick={handleRowClick}
    >
      <div className="flex w-full min-w-0 items-center gap-4">
        <Link
          href={href}
          prefetch
          draggable={false}
          aria-description={
            formattedDate ? `Last updated ${formattedDate}` : undefined
          }
          className="focus-visible:ring-border-strong block min-w-0 grow outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <div className="flex w-full items-center gap-4">
            <div className="grow overflow-hidden">
              <div className="text-sm/5 font-medium text-[var(--text-primary)]">
                {title}
              </div>
              {preview ? (
                <div className="min-h-0 w-fit max-w-full truncate text-sm/5 text-[var(--text-secondary)]">
                  {preview}
                </div>
              ) : (
                <div aria-hidden="true" className="mt-px h-0" />
              )}
            </div>
          </div>
        </Link>

        <div className="relative flex min-h-10 min-w-10 shrink-0 items-center justify-end gap-2 text-sm/5 text-[var(--text-tertiary)]">
          {formattedDate ? (
            <span
              aria-hidden="true"
              className={cn(
                "whitespace-nowrap pointer-fine:group-focus-within/project-conversation:opacity-0 pointer-fine:group-hover/project-conversation:opacity-0",
                isActionsOpen && "opacity-0"
              )}
              data-testid="project-conversation-date"
            >
              {formattedDate}
            </span>
          ) : null}
          <div
            className={cn(
              "flex items-center gap-1.5 pointer-fine:pointer-events-none pointer-fine:absolute pointer-fine:inset-y-0 pointer-fine:end-0 pointer-fine:opacity-0 pointer-fine:group-focus-within/project-conversation:pointer-events-auto pointer-fine:group-focus-within/project-conversation:opacity-100 pointer-fine:group-hover/project-conversation:pointer-events-auto pointer-fine:group-hover/project-conversation:opacity-100",
              isActionsOpen &&
                "pointer-events-auto opacity-100 pointer-fine:pointer-events-auto pointer-fine:opacity-100"
            )}
            data-prevent-default="true"
            data-testid="project-conversation-overflow-menu"
          >
            <ChatActionsMenu
              chat={chat}
              trigger={actionsTrigger}
              triggerAriaLabel={`Open conversation options for ${title}`}
              contentAlign="end"
              onOpenChange={setIsActionsOpen}
            />
          </div>
        </div>
      </div>
    </li>
  )
}

function ProjectConversationSkeleton() {
  return (
    <div
      className="border-border-subtle flex min-h-16 items-center border-b p-3"
      aria-hidden="true"
    >
      <div className="flex-1 space-y-2">
        <div className="bg-interactive-selected h-4 w-2/5 animate-pulse rounded" />
        <div className="bg-interactive-selected h-4 w-4/5 animate-pulse rounded" />
      </div>
      <div className="bg-interactive-selected ms-4 h-4 w-12 animate-pulse rounded" />
    </div>
  )
}

function ProjectConversationList({ projectId }: { projectId: Id<"projects"> }) {
  const { data, isLoading } = usePerUserQuery(
    api.chats.getProjectChatsForCurrentUser,
    { projectId }
  )
  const entries = useMemo<DirectoryEntry[] | undefined>(
    () =>
      data?.map(({ chat, preview }) => ({
        chat: convexChatToChat(chat),
        preview,
      })),
    [data]
  )

  if (isLoading || entries === undefined) {
    return (
      <div aria-label="Loading project chats" aria-busy="true">
        <ProjectConversationSkeleton />
        <ProjectConversationSkeleton />
        <ProjectConversationSkeleton />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-sm/5 text-[var(--text-secondary)]">
        <p className="font-medium text-[var(--text-primary)]">
          No chats in this project yet
        </p>
        <p className="mt-1">Start a new chat below to add the first one.</p>
      </div>
    )
  }

  return (
    <ol
      aria-label="Project conversations"
      aria-busy="false"
      className="divide-border-subtle divide-y"
    >
      {entries.map((entry) => (
        <ProjectConversationRow key={entry.chat.id} entry={entry} />
      ))}
    </ol>
  )
}

class ProjectConversationErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Failed to load project conversations", error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-sm/5 text-[var(--text-secondary)]"
        >
          <p className="font-medium text-[var(--text-primary)]">
            Couldn&apos;t load chats
          </p>
          <p className="mt-1">Refresh the page to try again.</p>
        </div>
      )
    }
    return this.props.children
  }
}

export function ProjectChatDirectory({
  projectId,
}: {
  projectId: Id<"projects">
}) {
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>("chats")

  return (
    <section className="mx-auto w-full max-w-(--project-detail-outer-width) px-4 pt-6 md:px-6 md:pt-8 md:max-lg:px-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ProjectDetailTab)}
        className="mx-auto w-full max-w-3xl gap-4"
      >
        <TabsList
          variant="pill"
          aria-label="Project sections"
          activateOnFocus
        >
          {PROJECT_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="focus-visible:ring-border-strong focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value="chats"
          tabIndex={0}
          className="focus-visible:ring-border-strong outline-none focus-visible:ring-2"
        >
          <ProjectConversationErrorBoundary>
            <ProjectConversationList projectId={projectId} />
          </ProjectConversationErrorBoundary>
        </TabsContent>

        <TabsContent
          value="sources"
          tabIndex={0}
          className="focus-visible:ring-border-strong outline-none focus-visible:ring-2"
        >
          <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-sm/5 text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">
              No project sources
            </p>
            <p className="mt-1">
              Project-level source aggregation isn&apos;t available yet.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

import React from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"
import { ScrollArea } from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/components/ui/scroll-area"
import {
  ActivityStep,
  ActivityTimeline,
  StepTitle,
} from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/activity-timeline"
import {
  ActivityPanelDockSlot,
  ActivityPanelHostProvider,
  useActivityPanelDockSlot,
} from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/activity-panel-host"
import { ContentSheetShell } from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/content-sheet-shell"
import { DockedFlyoutShell } from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/docked-flyout-shell"
import { SourceChipGroup } from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/source-chip-group"
import { SourcesGallery } from "/Users/andresgonzalez/Github/Projects/not-a-wrapper/app/components/chat/activity/sources-gallery"

const searchParams = new URLSearchParams(window.location.search)
const mode = searchParams.get("mode") ?? "desktop"
const theme = searchParams.get("theme") ?? "light"
const long = searchParams.get("long") === "1"

document.documentElement.classList.toggle("dark", theme === "dark")
document.body.dataset.theme = theme
document.body.dataset.mode = mode

const baseSources = [
  {
    href: "https://en.wikipedia.org/wiki/Quantum_computing",
    title: "Quantum computing - Wikipedia",
  },
  {
    href: "https://arxiv.org/abs/2301.12345",
    title: "Advances in Quantum Error Correction",
  },
  {
    href: "https://www.nature.com/articles/s41586-023-05837-9",
    title: "Suppressing quantum errors by scaling a surface code",
  },
  {
    href: "https://research.google/pubs/quantum-supremacy",
    title: "Quantum Supremacy Using a Programmable Processor",
  },
  {
    href: "https://openai.com/research",
    title: "OpenAI Research",
  },
]

const gallerySources = long
  ? Array.from({ length: 28 }, (_, index) => ({
      href: `https://example${index}.com/article/${index}`,
      title: `Reference source ${index + 1} with a moderately long title`,
    }))
  : baseSources

function ReasoningBody() {
  return (
    <div data-qa="panel-body" className="space-y-4">
      <ActivityTimeline className="animate-show px-3 motion-reduce:animate-none">
        <ActivityStep leading="globe" body="chips">
          <StepTitle>Browsing web for quantum error correction sources</StepTitle>
          <SourceChipGroup
            sources={baseSources.slice(0, 4).map((source) => ({
              href: source.href,
              label: new URL(source.href).hostname.replace(/^www\./, ""),
            }))}
            max={3}
          />
        </ActivityStep>
        <ActivityStep leading="bullet" body="description">
          <StepTitle>Comparing panel shell measurements</StepTitle>
          <p className="text-muted-foreground text-sm leading-5">
            Verifying card height, scroll containment, header placement, marker
            dimensions, and source gallery rhythm against the captured reference.
          </p>
        </ActivityStep>
        <ActivityStep leading="done" body="description">
          <StepTitle>Reasoning</StepTitle>
          <p className="text-muted-foreground text-sm leading-5">Done</p>
        </ActivityStep>
      </ActivityTimeline>
      <SourcesGallery
        sources={gallerySources}
        className="animate-show motion-reduce:animate-none"
      />
    </div>
  )
}

function ConversationColumn() {
  return (
    <div className="conversation-column">
      <header data-qa="page-header" className="page-header">
        <span className="font-medium">Not A Wrapper</span>
      </header>
      <main className="thread">
        <article className="user-bubble">
          Give me a concise research brief on quantum error correction.
        </article>
        <article className="assistant-turn">
          <p>
            Quantum error correction protects fragile qubits by distributing
            state over many physical qubits and detecting errors without
            measuring the encoded information directly.
          </p>
          <button className="activity-trigger" type="button">
            Activity
          </button>
        </article>
      </main>
      <div className="composer">Ask anything</div>
    </div>
  )
}

function DockedActivityPanel() {
  const slot = useActivityPanelDockSlot()

  return slot
    ? createPortal(
        <DockedFlyoutShell
          title="Activity"
          durationSeconds={342}
          onClose={() => {}}
        >
          <ReasoningBody />
        </DockedFlyoutShell>,
        slot
      )
    : null
}

function DesktopPage() {
  return (
    <ActivityPanelHostProvider>
      <div className="page-shell">
        <ConversationColumn />
        <ActivityPanelDockSlot />
      </div>
      <DockedActivityPanel />
    </ActivityPanelHostProvider>
  )
}

function SheetPage() {
  return (
    <div className="page-shell">
      <ConversationColumn />
      <ContentSheetShell
        open
        onOpenChange={() => {}}
        title="Activity"
        durationSeconds={342}
      >
        <ScrollArea
          role="region"
          aria-label="Activity details"
          className="min-h-0 flex-1"
        >
          <div className="px-6 pb-4">
            <ReasoningBody />
          </div>
        </ScrollArea>
      </ContentSheetShell>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  mode === "desktop" ? <DesktopPage /> : <SheetPage />
)

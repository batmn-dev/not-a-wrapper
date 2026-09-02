"use client"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { useUserPreferences } from "@/lib/user-preference-store/provider"

export function InteractionPreferences() {
  const {
    preferences,
    setShowToolInvocations,
    setShowConversationPreviews,
    setWebSearchEnabled,
    setStreamingPresentation,
    setShowGenerationStats,
  } = useUserPreferences()

  return (
    <FieldGroup className="gap-6 pb-12">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">
            Smooth text streaming
          </FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Fade newly streamed text in as responses stream. Turn off to show it
            at full color instantly.
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Smooth text streaming"
          checked={preferences.streamingPresentation !== "quick"}
          onCheckedChange={(enabled) =>
            setStreamingPresentation(enabled ? "smooth" : "quick")
          }
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">Tool invocations</FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Show tool execution details in conversations
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Tool invocations"
          checked={preferences.showToolInvocations}
          onCheckedChange={setShowToolInvocations}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">
            Conversation previews
          </FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Show conversation previews in history
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Conversation previews"
          checked={preferences.showConversationPreviews}
          onCheckedChange={setShowConversationPreviews}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">Web search default</FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Remember whether web search is enabled in new chats
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Web search default"
          checked={preferences.webSearchEnabled}
          onCheckedChange={setWebSearchEnabled}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">Generation stats</FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Show tokens per second, token counts, and time to first output under
            each response
          </FieldDescription>
        </FieldContent>
        <Switch
          aria-label="Generation stats"
          checked={preferences.showGenerationStats}
          onCheckedChange={setShowGenerationStats}
        />
      </Field>
    </FieldGroup>
  )
}

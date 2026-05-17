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
    setPromptSuggestions,
    setShowToolInvocations,
    setShowConversationPreviews,
    setWebSearchEnabled,
  } = useUserPreferences()

  return (
    <FieldGroup className="gap-6 pb-12">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle className="text-balance">Prompt suggestions</FieldTitle>
          <FieldDescription className="text-xs text-pretty">
            Show suggested prompts when starting a new conversation
          </FieldDescription>
        </FieldContent>
        <Switch
          checked={preferences.promptSuggestions}
          onCheckedChange={setPromptSuggestions}
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
          checked={preferences.webSearchEnabled}
          onCheckedChange={setWebSearchEnabled}
        />
      </Field>
    </FieldGroup>
  )
}

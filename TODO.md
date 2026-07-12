# To Do

- **Chat side panel:** finish the live multi-step timeline. Preserve the
  intentional `ActivityPanel`, `ActivityTimeline`, and
  `DockedFlyoutShell.viewportRef` scaffolding; re-verify live thinking behavior
  against a current reference before wiring speculative `phase` behavior.
- **Better in-progress conversation view:** persist and surface active progress
  when a user leaves and returns to a streaming chat.
- Add chat-composer dictation, in-chat image generation, interactive response
  widgets, an agent file library, connectors, admin controls, and a documented
  design system.
- **AI SDK follow-up:** migrate `experimental_transform` when a stable alias
  ships. Keep the Anthropic `pause_turn` workaround until the provider supports
  continuation, and adopt signed approval tokens only with a cross-instance
  secret plus a pending-approval deployment strategy. Replace
  `result.toUIMessageStream(...)` in `chat-turn-runtime.ts` with the standalone
  AI SDK 7 converter before the next major removes the compatibility helper.
- **AI SDK compatibility debt:** rename the legacy `.agents/skills/ai-sdk-v6/`
  directory when a coordinated path migration is safe, and move OpenRouter off
  its V3 model/`ai@6` peer surface when its provider package ships V4 support.
- **Edit/regeneration freshness:** replace the selected-message count proxy with
  a server-issued revision or equivalent identity-bearing token. The unresolved
  drift scenario and verification requirements live in
  `docs/streaming-persistence-concurrency-audit-prompt.md`.
- **Exa verification:** after saving a valid BYOK Exa key, verify one search turn
  and one `extract_content` turn. The current stored key was rejected by Exa.
- **Model presentation:** centralize route labels and icon precedence currently
  duplicated across model selectors and settings.
- **Sidebar rows:** consolidate chat, project-chat, and project rows around the
  existing `SidebarRow` and trailing-button primitives without changing their
  single-link, focus-guard, or reveal behavior.

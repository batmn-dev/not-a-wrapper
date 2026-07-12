# To Do

- **Chat side panel:** finish the live multi-step timeline. Preserve the
  intentional `ActivityPanel`, `ActivityTimeline`, and
  `DockedFlyoutShell.viewportRef` scaffolding; re-verify live thinking behavior
  against a current reference before wiring speculative `phase` behavior.
- **Better in-progress conversation view:** persist and surface active progress
  when a user leaves and returns to a streaming chat.
- **Add chat-composer dictation**
- **Image generation**
- **Assistant Response UI Widgets:** Image Carousels, Image Previews, Weather, Stock UI, Charts (maybe), editable markdown (maybe)
- **Agent-first file library**
- **Connectors:** Integrations with Google, YouTube, Figma, and personal tools
- **Agentic Design System:** A customizable design system that helps agents ship consistent and high quality UI
- **Admin Portal:** A way to manage users, controls, features, etc...
- **AI SDK follow-up:** migrate `experimental_transform` when a stable alias
  ships. Keep the Anthropic `pause_turn` workaround until the provider supports
  continuation, and adopt signed approval tokens only with a cross-instance
  secret plus a pending-approval deployment strategy.
- **Edit/regeneration freshness:** replace the selected-message count proxy with
  a server-issued revision or equivalent identity-bearing token. The unresolved
  drift scenario and verification requirements live in
  `docs/streaming-persistence-concurrency-audit-prompt.md`.
- **Exa verification:** after saving a valid BYOK Exa key, verify one search turn
  and one `extract_content` turn. The current stored key was rejected by Exa.
- **Model presentation:** centralize route labels and icon precedence currently
  duplicated across model selectors and settings.

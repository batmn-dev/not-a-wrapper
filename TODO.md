# To Do Items

A list of tasks we should eventually implement when the time is right

- Chat side panel (ChatGPT-style): expose reasoning, sources, and other turn metadata without cluttering the main thread.
  - Activity-panel live multi-step timeline. Scaffolding is already in place and kept INTENTIONALLY (do not "clean up" as dead code):
    - `ActivityPanel` carries `steps` / `phase` / `isReasoningStreaming` via `panelProps` but does not render them yet (`app/components/chat/activity/activity-panel.tsx` — see the annotated `ActivityPanelProps`).
    - `ActivityTimeline` keeps the `globe` / `bullet` markers and the `chips` body cva variants for the multi-step view (`activity/activity-timeline.tsx`); today only `done` / `description` render.
    - `DockedFlyoutShell.viewportRef` is wired to the ScrollArea for auto-scroll-on-stream but is not passed yet.
    - `components/ui/badge.tsx` `variant="source"` now styles the settled-turn sources badge (`app/components/chat/sources-badge.tsx`); the panel's timeline source chips can compose or extend it when the multi-step view lands.
    - Reference grounding (checked against `reference-ui/ChatGPT`): `steps` + the three markers + chip bodies are SUPPORTED (the capture shows 40 steps); `isReasoningStreaming` + panel auto-scroll are PARTIAL (animation + reserved slot present, live behavior not captured); `phase` ("thinking"/"complete") is NOT-FOUND in the captures (settled-state only) — speculative, re-verify against a live "still thinking" capture before wiring.
- Dictation in the chat composer: voice input to text for message entry.
- Sidebar chat status indicators (ChatGPT-style): show in-progress, unread, or other per-chat state in the sidebar list.
- In-chat image generation: prompt-to-image in the conversation flow, similar to ChatGPT.
- Interactive response widgets: richer agent UX for structured outputs (weather, stock charts, link/image previews, etc.).
- Agent file library: a durable file system or library the agent can browse and reference across chats.
- Connectors: integrate external apps and data sources the agent can use during conversations.
- Admin controls: user management, feature access, token usage, and potential billing controls.
- Design system for new UI: build reusable components and document components and design patterns for agents to follow.
- Better in-progress conversation view: investigate and replicate a richer streaming/thinking state. Leaving a chat tab while the model is thinking and returning shows an empty thinking state — no progress indicator, no sign of where the model currently is. Persist and surface in-progress status so returning to the tab shows live progress.

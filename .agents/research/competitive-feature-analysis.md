# Competitive Feature Analysis: Not A Wrapper vs. ChatGPT & Claude

> **Date**: February 6, 2026 (updated February 7, 2026)
> **Scope**: Web-based chat features of ChatGPT (chat.openai.com) and Claude (claude.ai) compared against the Not A Wrapper open-source codebase.

---

## 1. Executive Summary

- **ChatGPT** has evolved into a full-stack productivity platform with GPT-5, native image generation, deep research, agent mode (Operator integrated), an apps/connectors ecosystem (60+ apps on Business plan, with developer mode for unverified connectors), branching chats, tasks/scheduling with a dedicated schedules UI, orders/shopping, granular personalization (base style & tone, characteristics, profile info, record mode, per-feature toggles for search/code/canvas/voice), push and email notifications with per-category controls, comprehensive data controls (training opt-out, remote browser data, bulk archive/delete, shared links management), and robust account security (passkeys, MFA, per-device session management). Its six-tier pricing (Free → Go $8/mo → Plus $20/mo → Pro $200/mo → Business → Enterprise) covers every segment.
- **Claude** has differentiated through Artifacts (interactive app creation), connectors/MCP integrations (Google Workspace, Slack), memory across conversations (Pro), deep extended thinking, Projects with RAG, and Research mode. Its Max plan ($100-$200/mo) targets power users with 5-20x usage limits.
- **Not A Wrapper** has strong fundamentals — 10 providers, 73+ models, BYOK encryption, multi-model comparison, web search, projects, and sharing. However, it still has major feature gaps including no image generation, no code execution, no artifacts/canvas, no conversation export, no memory, no branching, no native integrations, no notifications, no granular personalization, no data controls beyond Clerk defaults, and no schedules/orders.
- The four highest-impact gaps to close remain: **(1) MCP integration into chat flow** (unlocks the "universal AI interface" positioning), **(2) Message reactions** (low-effort UX polish; drag-and-drop exists but needs minor accept/UX polish), **(3) Conversation export** (leapfrogs competitors who both have weak native export), and **(4) Artifacts/interactive outputs** (transformational). Additionally, ChatGPT's expanding platform features — notifications, granular personalization, schedules, orders, data controls, and passkey/MFA security — widen the "platform maturity" gap and should be tracked for future prioritization.
- Not A Wrapper's unique positioning (multi-provider, BYOK, open-source) is a genuine competitive moat. The roadmap should lean into this by becoming the **universal AI interface** rather than cloning any single provider's walled garden.

---

## 2. Phase 1: Competitive Feature Catalog

### 2.1 Core Chat Experience

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Rich text input | Yes | Yes | Markdown formatting, code blocks in input | Medium |
| Streaming responses | Yes | Yes | Token-by-token rendering with typewriter effect | High |
| Message editing | Yes | Yes | Edit any user message and regenerate from that point | High |
| Regenerate response | Yes | Yes | Re-generate assistant response with same or different model | High |
| Stop generation | Yes | Yes | Halt streaming mid-response | High |
| Copy message | Yes | Yes | Copy individual messages to clipboard | Medium |
| Share individual message | Yes | No | Share a specific message excerpt | Low |
| Message reactions | Yes (thumbs) | Yes (thumbs) | Thumbs up/down feedback on responses | Medium |
| Branching chats | Yes (2025) | No | Fork a conversation to explore alternative paths | Medium |
| Message bookmarking | Yes | No | Bookmark specific messages within a conversation | Low |

### 2.2 Model Selection & Configuration

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Model picker | Yes | Yes | Dropdown/selector to choose model before or during chat | High |
| Dynamic model routing | Yes (GPT-5) | No | Auto-routes between model variants based on complexity | Medium |
| Reasoning/thinking mode | Yes (o3/o4) | Yes (extended thinking) | Toggle deep reasoning for complex problems | High |
| Model capabilities display | Limited | Limited | Show what each model can do (vision, tools, etc.) | Medium |
| Default model setting | Yes | Yes | Set preferred model as default | Medium |

### 2.3 Multi-Modal Input

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Image upload (vision) | Yes | Yes | Upload images for analysis and discussion | High |
| PDF upload | Yes | Yes | Upload and analyze PDF documents | High |
| File upload (code, docs) | Yes | Yes | Upload various file types for analysis | High |
| Audio input / voice mode | Yes | No (web) | Voice conversation with speech-to-text | Medium |
| Camera/screenshot capture | Yes (mobile) | No | Capture and share screen or camera input | Low |
| Drag and drop | Yes | Yes | Drag files into chat input | Medium |
| Clipboard paste (images) | Yes | Yes | Paste images from clipboard | Medium |

### 2.4 Multi-Modal Output

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Image generation | Yes (ChatGPT Images) | No | Generate images from text prompts within chat | High |
| Image editing | Yes | No | Modify generated images with natural language | Medium |
| Audio/voice output | Yes (voice mode) | No (web) | Spoken responses with emotive synthesis | Medium |
| Code execution sandbox | Yes (Python) | Yes (API/Artifacts) | Execute code in isolated environment, see results | High |
| Artifacts / Canvas | Yes (Canvas) | Yes (Artifacts) | Interactive side-panel for documents, code, apps | High |
| Data visualization | Yes (charts via code exec) | Yes (via Artifacts) | Generate charts and graphs from data | Medium |
| Document generation | Yes (Canvas) | Yes (Artifacts) | Create and edit documents collaboratively | Medium |

### 2.5 Web Search & Real-Time Data

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Built-in web search | Yes | Yes | Search the internet for current information | High |
| Source citations | Yes | Yes | Inline citations with links to sources | High |
| Deep research | Yes (autonomous) | Yes (Research mode) | Multi-step autonomous research producing reports | High |
| Search result previews | Yes | Limited | Preview snippets from search results | Medium |
| Image search results | Yes | No | Return image results from web search | Low |

### 2.6 Tools & Integrations

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Code interpreter | Yes | Yes (Artifacts) | Execute Python/JS code with output | High |
| File analysis / data processing | Yes (512MB/file; 10GB user cap) | Yes | Analyze uploaded data files, CSVs, spreadsheets | High |
| App ecosystem (native) | Yes (apps/connectors; 60+ on Business) | Yes (connectors + MCP; list varies) | Google Drive, Dropbox, Slack, etc. | High |
| MCP support | Yes (connectors + remote MCP servers) | Yes (connectors + MCP) | Model Context Protocol for tool integration | Medium |
| Google Workspace sync | Yes (connectors; plan/region dependent) | Yes (Pro; via connectors) | Direct file access from Google Drive, Calendar, Docs | Medium |
| GitHub integration | Yes (connector; plan/region dependent) | Limited (Claude Code) | Access repos, search code, cite commits | Medium |
| Slack integration | Yes (connector/app; plan dependent) | Yes (connector/app; plan dependent) | Read/write Slack messages | Medium |
| Tasks / scheduling | Yes | No | Set reminders and recurring automated tasks | Medium |
| Schedules management UI | Yes | No | Dedicated UI to view, edit, pause, and delete scheduled/recurring tasks | Medium |
| Developer mode (custom connectors) | Yes | No | Allow adding unverified/custom MCP connectors for testing and development | Medium |

### 2.7 Memory & Personalization

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Cross-conversation memory | Yes | Yes (Pro) | Remember facts and preferences across chats | High |
| Custom instructions | Yes | Yes (system prompt) | Set persistent instructions for all conversations | High |
| Memory management UI | Yes | Yes | View, edit, delete stored memories | Medium |
| Personalization signals | Yes | Limited | Learn from interaction patterns | Medium |
| Project-scoped instructions | Yes (Projects) | Yes (Projects) | Different instructions per project context | Medium |
| Profile info ("About You") | Yes | No | Store personal/professional context the AI references across all chats | Medium |
| Base style & tone | Yes | No | Set response style preferences (casual, formal, concise, detailed) applied globally | Medium |
| Personality characteristics | Yes | No | Define AI personality traits (creative, analytical, direct, encouraging, etc.) | Medium |
| Record mode | Yes | No | Record and transcribe voice input for text-based messages | Low |
| Feature-level toggles | Yes | No | Per-feature on/off controls: web search, code interpreter, canvas, ChatGPT voice, advanced voice, connector search | Medium |

### 2.8 Conversation Management

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Chat history sidebar | Yes | Yes | Browsable list of past conversations | High |
| Search across conversations | Yes | Yes | Full-text search of chat history | High |
| Projects / folders | Yes | Yes (Pro) | Organize chats into project workspaces | High |
| Pin / star conversations | Yes | Yes | Pin important chats for quick access | Medium |
| Archive conversations | Yes | Yes | Hide without deleting | Low |
| Branching / forking | Yes | No | Create alternative conversation paths | Medium |
| Export (JSON/PDF/MD) | Limited (account data export only) | Limited (account data export via email link) | Export individual conversations — neither competitor has native per-conversation export | Medium |
| Cross-device sync | Yes | Yes | Conversations available on all devices | High |

### 2.9 Collaboration & Sharing

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Public share links | Yes | Yes | Generate shareable URL for a conversation | High |
| Team workspaces | Yes (Business/Enterprise) | Yes (Team/Enterprise) | Shared workspace with roles and permissions | Medium |
| Shared projects | Yes | Yes (Team+) | Collaborate on project context | Medium |
| Published prompt libraries | Yes (GPT Store) | No | Marketplace for custom prompts/agents | Medium |
| Custom GPTs / bots | Yes (GPT Builder) | No | Create specialized chatbots | High |

### 2.10 Code & Developer Features

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Syntax highlighting | Yes | Yes | Language-aware code formatting | High |
| Code block copy | Yes | Yes | One-click copy for code blocks | High |
| Code execution sandbox | Yes | Yes (Artifacts) | Run code and see output inline | High |
| Interactive code previews | Yes (Canvas) | Yes (Artifacts) | Live preview of HTML/CSS/JS | High |
| Version history for edits | Yes (Canvas) | Yes (Artifacts) | Restore previous versions of code/docs | Medium |

### 2.11 UI/UX & Accessibility

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Dark/light theme | Yes | Yes | Theme toggle | High |
| Responsive mobile design | Yes | Yes | Full mobile experience | High |
| Keyboard shortcuts | Yes (10+) | Limited | Productivity shortcuts | Medium |
| Command palette | No (native) | No | Quick action search | Medium |
| Onboarding flow | Yes | Yes | First-time user guidance | Medium |
| Accent color customization | Yes | No | Personalize UI colors | Low |

### 2.12 Monetization & Plans

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Free tier | Yes (GPT-5.2 limited, search, Canvas) | Yes (Artifacts; web search rolling out) | Generous free tier | High |
| Budget tier ($8/mo) | Go ($8/mo, may include ads) | — | Expanded GPT-5.2 access, more messages | Medium |
| Mid-tier ($20/mo) | Plus ($20/mo) | Pro ($20/mo; $17/mo annual) | Standard paid tier | High |
| Premium tier ($100-200/mo) | Pro ($200/mo) | Max ($100-200/mo) | Power user tier | Medium |
| Enterprise | Yes (Business + Enterprise) | Yes (Team + Enterprise) | Custom pricing with SSO, audit logs | Medium |
| Education tier | Yes (Edu) | Yes (Education) | University pricing | Low |

### 2.13 Advanced / Emerging Features

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Agent mode | Yes (agent mode; Operator integrated Aug 2025) | No (web) | Autonomous web browsing and task execution | High |
| Scheduled tasks | Yes (Tasks) | No | Recurring reminders and automated prompts | Medium |
| Canvas / document editor | Yes | Yes (Artifacts) | Side-by-side collaborative editing | High |
| Deep research | Yes (limits by plan: Free 5, Plus/Team/Enterprise 25, Pro 250) | Yes (Research mode) | Multi-step autonomous research | High |
| Autonomous web agent | Yes (Agent Mode) | No (web) | Browse websites, fill forms, complete tasks | High |
| Computer use (screen control) | Yes (agent mode virtual browser) | Yes (API only, beta) | View screen, move cursor, click, type via AI | Low |
| Custom GPTs | Yes (GPT Builder + Store) | No | Build and share custom AI agents | High |
| Orders / Shopping | Yes | No | Place orders and make purchases through AI agent (integrated commerce) | Medium |

### 2.14 Notifications

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Push notifications | Yes | No | Browser/mobile push notifications for responses, tasks, and recommendations | Medium |
| Email notifications | Yes | No | Email alerts for responses, group chats, tasks, projects, and usage summaries | Medium |
| Notification categories | Yes | No | Granular per-category control: responses, group chats, tasks, projects, recommendations, usage | Medium |

### 2.15 Data Controls & Privacy

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Training data opt-out | Yes ("Improve model for everyone") | Yes | Toggle whether conversations are used for model training | High |
| Remote browser data | Yes | No | Control retention of data from agent web browsing sessions | Medium |
| Shared links management | Yes | Yes | View, manage, and revoke publicly shared conversation links | Medium |
| Manage archived chats | Yes | No | Browse, restore, or permanently delete archived conversations | Medium |
| Archive all chats | Yes | No | Bulk archive all conversations at once | Low |
| Delete all chats | Yes | Yes | Bulk delete entire conversation history | Medium |
| Export data | Yes (zip download) | Yes (email link) | Download all account data as an archive file | Medium |

### 2.16 Account Security

| Feature | ChatGPT | Claude | Description | User Value |
|---------|---------|--------|-------------|------------|
| Password authentication | Yes | Yes | Traditional password-based login | High |
| Passkeys (FIDO2/WebAuthn) | Yes | No | Passwordless biometric or hardware key authentication | Medium |
| Multi-factor authentication | Yes | Yes | TOTP or SMS second-factor verification | High |
| Per-device session management | Yes | Limited | View active sessions and log out of specific devices | Medium |
| Log out all devices | Yes | Yes | Force logout across all active sessions at once | Medium |

### 2.17 Prompt Box Interaction Patterns

These are the UX mechanisms users use to **discover and invoke features** directly from the chat input area. Both ChatGPT and Claude have converged on similar patterns, making them emerging conventions that users now expect.

#### `/` Slash Command Menu

Both platforms surface a popover menu when the user types `/` in the prompt box. This is the **primary discoverability mechanism** for input-level features.

| Menu Item | ChatGPT | Claude | Description |
|-----------|---------|--------|-------------|
| Attach files/photos | Yes ("Add files or photos") | Yes ("Add photos & files") | Opens file picker for uploads |
| Screenshot capture | Yes ("Take a screenshot") | No | Capture and attach a screenshot |
| Add to project | Yes ("Add to project" → submenu) | No | Assign prompt to a project folder |
| Web search toggle | Yes ("Web search" ✓ toggle) | No | Enable/disable web search for this message |
| Style/tone presets | Yes ("Use style" → submenu) | No | Apply a writing style to the response |
| Image generation | No (auto-routed) | Yes ("Create image") | Invoke image generation mode |
| Deep research | No (model picker) | Yes ("Deep research") | Invoke multi-step research mode |
| Agent mode | No (model picker) | Yes ("Agent mode") | Enable autonomous agent behavior |
| Add sources | No | Yes ("Add sources") | Attach reference sources/context |
| Filter/search | Yes ("Type to filter" at bottom) | No | Filter menu items by typing |

**Key design observations:**
- **ChatGPT** uses `/` primarily for **input configuration** (what to attach, how to search, what style to use). Feature modes like deep research and agent are accessed via the model picker dropdown instead.
- **Claude** uses `/` primarily for **mode switching** (research, agent, image gen) plus basic file attachment. Configuration like web search lives elsewhere.
- Both show icons + labels for each item, with `>` chevrons for items that have submenus.
- ChatGPT includes a filter/search input at the bottom of the menu for discoverability at scale.
- Items can show state indicators (ChatGPT shows a checkmark `✓` next to "Web search" when enabled).

#### `@` Mention System (Integrations/Apps)

ChatGPT surfaces connected apps and integrations when the user types `@` in the prompt box. Claude does not have an equivalent `@` pattern on the web app.

| App/Integration | ChatGPT | Claude | Description |
|-----------------|---------|--------|-------------|
| Shopping research | Yes | No | Product research and comparison |
| Figma | Yes | No | Access Figma designs and components |
| Instacart | Yes | No | Grocery ordering integration |
| OpenTable | Yes | No | Restaurant reservation integration |
| Adobe Acrobat | Yes | No | PDF tools and document processing |
| Google Drive | Yes | No | Access Drive files (connector-based) |
| Slack | Yes | No | Access Slack messages (connector-based) |
| _Custom connectors_ | Yes (developer mode) | No | User-added MCP/connector integrations |

**Key design observations:**
- The `@` menu is scoped exclusively to **external integrations/apps** — it's the tool invocation mechanism.
- Each item shows the app's icon/logo for instant recognition.
- Available items vary by plan (60+ on Business, fewer on Plus/Free).
- ChatGPT's `@` mention stays in the prompt as visible text (e.g., `@Figma design specs for...`), giving users a clear signal that a tool will be invoked.
- This pattern is analogous to `@`-mentioning a person in Slack/Discord — intuitive and well-understood.

#### Other Prompt Box Affordances

| Affordance | ChatGPT | Claude | Description |
|------------|---------|--------|-------------|
| Persistent action buttons | Yes (attach, search, voice) | Yes (attach) | Always-visible icon buttons below/beside input |
| Model picker in input area | Yes (dropdown above input) | Yes (dropdown above input) | Switch models without leaving the prompt |
| Submit button position | Right side of input | Right side of input | Send message button |
| Multiline input | Yes (auto-expand) | Yes (auto-expand) | Input grows as user types |
| Keyboard submit | Enter (Shift+Enter for newline) | Enter (Shift+Enter for newline) | Standard submit pattern |
| Character/token indicator | No | No | Neither shows remaining capacity |
| Drag-drop overlay | Yes | Yes | Visual overlay when dragging files over input |

#### Competitive Pattern Summary

```
┌─────────────────────────────────────────────────┐
│ ChatGPT Prompt Box Architecture                 │
│                                                 │
│  [Model Picker ▾]                               │
│  ┌─────────────────────────────────────────────┐│
│  │ Message input area...                       ││
│  │                                             ││
│  │ /  → Feature menu (attach, search, style)   ││
│  │ @  → App/integration menu (Figma, etc.)     ││
│  ├─────────────────────────────────────────────┤│
│  │ 📎 🔍 🎤              [Send ➤]             ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Claude Prompt Box Architecture                  │
│                                                 │
│  [Model Picker ▾]                               │
│  ┌─────────────────────────────────────────────┐│
│  │ Message input area...                       ││
│  │                                             ││
│  │ /  → Mode menu (image, research, agent)     ││
│  ├─────────────────────────────────────────────┤│
│  │ 📎                     [Send ➤]             ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

---

## 3. Phase 2: Current Not A Wrapper Feature Inventory

### Mapped Against Competitive Categories

| Category | Feature | Status | Key Files |
|----------|---------|--------|-----------|
| **Core Chat** | Streaming responses (AI SDK v6) | Fully implemented | `app/api/chat/route.ts` |
| | Message editing (truncate + re-stream) | Fully implemented | `use-chat-core.ts` |
| | Regeneration | Fully implemented | `use-chat-core.ts` |
| | Stop generation | Fully implemented | `use-chat-core.ts` |
| | Quoted text selection | Fully implemented | `quote-button.tsx` |
| | Markdown rendering | Fully implemented | `components/ui/markdown` |
| | Copy message | Fully implemented | `message-assistant.tsx` |
| | Message reactions / feedback | **Not implemented** | — |
| | Branching / forking | **Not implemented** | — |
| **Model Selection** | Model picker with rich metadata | Fully implemented | `chat-input/`, `lib/models/` |
| | 10 providers, 73+ models | Fully implemented | `lib/models/data/` |
| | Per-model capability flags | Fully implemented | `ModelConfig` type |
| | Reasoning display | Fully implemented | `reasoning.tsx` |
| | Multi-model comparison (up to 10) | Implemented (MAX_MODELS=10; search disabled in multi-chat) | `multi-chat.tsx`, `use-multi-chat.ts` |
| **Multi-Modal Input** | Image upload + vision | Fully implemented | `convex/files.ts` |
| | PDF upload | Partially implemented (validation allows; picker accept list missing; 10MB, 5/day) | `lib/file-handling.ts`, `convex/files.ts`, `button-file-upload.tsx` |
| | File upload (TXT, MD, JSON, CSV, Excel) | Implemented (10MB limit, 5/day; validation allows; picker accept list limited) | `lib/file-handling.ts`, `convex/files.ts`, `button-file-upload.tsx` |
| | Clipboard paste (images) | Fully implemented | `chat-input/` |
| | Audio input | **Not implemented** | — |
| | Drag and drop | Fully implemented (global drag/drop via FileUpload) | `components/ui/file-upload.tsx` |
| **Multi-Modal Output** | Image generation | **Not implemented** | — |
| | Audio output | **Not implemented** | — |
| | Code execution sandbox | **Not implemented** | — |
| | Artifacts / interactive outputs | **Not implemented** | — |
| | Data visualization | **Not implemented** (UI components only) | `components/ui/chart.tsx` |
| **Web Search** | Per-message search toggle | Fully implemented | `button-search.tsx` |
| | Model capability gating | Fully implemented | `webSearch` flag |
| | Source citations with favicons | Fully implemented | `sources-list.tsx` |
| | Image search results | Renderer only (expects tool output) | `message-assistant.tsx`, `search-images.tsx` |
| | Deep research | **Not implemented** | — |
| **Tools & Integrations** | Tool invocation display | Fully implemented | `tool-invocation.tsx` |
| | MCP client (stdio + SSE) | Library only, not integrated | `lib/mcp/` |
| | Third-party app integrations | **Not implemented** | — |
| **Memory** | Cross-conversation memory | **Not implemented** | — |
| | System prompt (custom instructions) | Fully implemented | `convex/users.ts` |
| | Memory management UI | **Not implemented** | — |
| **Conversation Mgmt** | Chat history sidebar | Fully implemented | `app-sidebar.tsx` |
| | Command palette search (Cmd+K) | Partially implemented (title-only search) | `command-history.tsx` |
| | Date-grouped chat list | Fully implemented | `sidebar-list.tsx` |
| | Pinned chats | Fully implemented | `togglePin` mutation |
| | Projects / folders | Fully implemented | `convex/projects.ts` |
| | Conversation export | **Not implemented** | — |
| | Chat archiving | **Not implemented** | — |
| **Sharing** | Public share links | Fully implemented | `dialog-publish.tsx` |
| | Share on X/Twitter | Fully implemented | Share page OG metadata |
| | Server-rendered share pages | Fully implemented | `app/share/[chatId]/` |
| | Team workspaces | **Not implemented** | — |
| **Code Features** | Syntax highlighting | Fully implemented | Markdown renderer |
| | Code block copy | Fully implemented | Copy button on code blocks |
| | Code execution | **Not implemented** | — |
| | Interactive previews | **Not implemented** | — |
| **UI/UX** | Dark/light theme | Fully implemented | `theme-selection.tsx` |
| | Responsive/mobile | Fully implemented | Drawer variants |
| | Command palette | Fully implemented | `Cmd+K` |
| | Keyboard shortcuts | Limited (Cmd+K, Cmd+Shift+U) | `command-history.tsx`, `button-new-chat.tsx` |
| | Onboarding flow | No guided flow (empty state only) | `chat.tsx`, `multi-chat.tsx` |
| **BYOK & Security** | Per-provider key storage (AES-256-GCM) | Fully implemented | `lib/encryption.ts` |
| | Provider status check | Fully implemented | `user-key-status` API |
| | Settings UI | Fully implemented | Settings 5-tab layout |
| **Rate Limiting** | Tiered limits (anonymous/auth/pro) | Fully implemented | `lib/config.ts`, `convex/usage.ts` |
| **Auth** | Clerk (login, signup, OAuth, guest) | Fully implemented | `middleware.ts` |
| **Analytics** | PostHog LLM tracking | Fully implemented | `lib/posthog/` |
| **Notifications** | Push notifications | **Not implemented** | — |
| | Email notifications | **Not implemented** | — |
| | Notification preferences (per-category) | **Not implemented** | — |
| **Personalization** | Base style & tone settings | **Not implemented** | — |
| | Personality characteristics | **Not implemented** | — |
| | Profile info ("About You") | **Not implemented** | — |
| | Record mode | **Not implemented** | — |
| | Feature-level toggles | **Not implemented** | — |
| **Data Controls** | Training data opt-out | **Not implemented** | — |
| | Shared links management | **Not implemented** (share creation exists) | `dialog-publish.tsx` |
| | Bulk archive/delete chats | **Not implemented** | — |
| | Data export (account) | **Not implemented** | — |
| | Remote browser data controls | N/A (no agent browsing) | — |
| **Account Security** | Password authentication | Delegated to Clerk | `middleware.ts` |
| | Passkeys (FIDO2/WebAuthn) | Delegated to Clerk (if enabled) | `middleware.ts` |
| | Multi-factor authentication | Delegated to Clerk (if enabled) | `middleware.ts` |
| | Per-device session management | Delegated to Clerk | `middleware.ts` |
| | Log out all devices | Delegated to Clerk | `middleware.ts` |
| **Schedules** | Scheduled/recurring tasks | **Not implemented** | — |
| | Schedules management UI | **Not implemented** | — |
| **Orders** | Shopping/ordering via AI | **Not implemented** | — |
| **Prompt Box Patterns** | `/` slash command menu | **Not implemented** | — |
| | `@` mention for integrations/apps | **Not implemented** | — |
| | Persistent action buttons (attach, search, voice) | Partially implemented (attach, search toggle) | `button-file-upload.tsx`, `button-search.tsx` |
| | Model picker in input area | Fully implemented | `chat-input/` |
| | Multiline auto-expand input | Fully implemented | `chat-input/` |
| | Drag-drop overlay | Fully implemented | `components/ui/file-upload.tsx` |

---

## 4. Phase 3: Gap Analysis

### 4a. Feature Comparison Matrix

| Feature | ChatGPT | Claude | Not A Wrapper | Gap Level |
|---------|---------|--------|---------------|-----------|
| Streaming chat | Yes | Yes | Yes | **None** |
| Message editing | Yes | Yes | Yes | **None** |
| Regeneration | Yes | Yes | Yes | **None** |
| Stop generation | Yes | Yes | Yes | **None** |
| Copy message | Yes | Yes | Yes | **None** |
| Quoted text selection | No | No | Yes | **Opportunity** |
| Multi-model comparison | No | No | Yes (up to 10; search disabled) | **Opportunity** |
| BYOK encryption | No | No | Yes (AES-256-GCM) | **Opportunity** |
| 10 providers / 73+ models | No (1 provider) | No (1 provider) | Yes | **Opportunity** |
| Open source | No | No | Yes | **Opportunity** |
| Model picker with metadata | Basic | Basic | Rich (speed, cost, context) | **None** |
| Message reactions / feedback | Yes | Yes | No (feedback table only) | **Major** |
| Branching chats | Yes | No | No | **Minor** |
| Image upload / vision | Yes | Yes | Yes | **None** |
| File upload (PDF, docs) | Yes | Yes | Yes (PDF/CSV/JSON/Excel; picker limited) | **Minor** |
| Audio input / voice | Yes | No | No | **Major** |
| Drag and drop files | Yes | Yes | Yes (FileUpload drag/drop) | **None** |
| Image generation | Yes (native) | No | No | **Major** |
| Code execution sandbox | Yes | Yes | No | **Major** |
| Artifacts / Canvas | Yes | Yes | No | **Major** |
| Data visualization | Yes | Yes | No (UI components only) | **Major** |
| Web search | Yes | Yes | Yes (model-gated) | **None** |
| Source citations | Yes | Yes | Yes | **None** |
| Image search results | Yes | No | No (renderer only) | **Minor** |
| Deep research | Yes | Yes | No | **Major** |
| App integrations (apps/connectors) | Yes (plan-based) | Yes (plan-based) | No | **Major** |
| MCP integration | Yes | Yes | Library only | **Major** |
| Cross-conversation memory | Yes | Yes | No | **Major** |
| Custom instructions | Yes | Yes | Yes (system prompt) | **None** |
| Memory management UI | Yes | Yes | No | **Major** |
| Chat history sidebar | Yes | Yes | Yes | **None** |
| Full-text search | Yes | Yes | Title-only (Cmd+K) | **Minor** |
| Projects / folders | Yes | Yes | Yes | **None** |
| Pinned chats | Yes | Yes | Yes | **None** |
| Chat archiving | Yes | Yes | No | **Minor** |
| Conversation export | Limited (account data export) | Limited (account export via email link) | No | **Moderate** |
| Public share links | Yes | Yes | Yes | **None** |
| Team workspaces | Yes | Yes | No | **Major** |
| Custom GPTs / agents | Yes | No | No (sub-agent types only) | **Major** |
| Syntax highlighting | Yes | Yes | Yes | **None** |
| Code block copy | Yes | Yes | Yes | **None** |
| Dark/light theme | Yes | Yes | Yes | **None** |
| Responsive mobile | Yes | Yes | Yes | **None** |
| Command palette | No | No | Yes (Cmd+K) | **Opportunity** |
| Keyboard shortcuts (10+) | Yes | Limited | Limited (Cmd+K, Cmd+Shift+U) | **Minor** |
| Onboarding flow | Yes | Yes | No (empty state only) | **Minor** |
| Scheduled tasks | Yes | No | No | **Minor** |
| Agent mode | Yes | No | No | **Major** |
| Push/email notifications | Yes | No | No | **Moderate** |
| Notification preferences (per-category) | Yes | No | No | **Moderate** |
| Granular personalization (style, tone, traits) | Yes | No | No | **Moderate** |
| Profile info ("About You") | Yes | No | No | **Moderate** |
| Feature-level toggles (search, code, canvas, voice) | Yes | No | No | **Minor** |
| Record mode | Yes | No | No | **Minor** |
| Developer mode (unverified connectors) | Yes | No | No | **Minor** |
| Schedules management UI | Yes | No | No | **Minor** |
| Orders / Shopping | Yes | No | No | **Minor** |
| Training data opt-out | Yes | Yes | No | **Moderate** |
| Remote browser data controls | Yes | No | N/A (no agent browsing) | **Minor** |
| Shared links management | Yes | Yes | No (creation only) | **Minor** |
| Bulk archive/delete all chats | Yes | Partial | No | **Minor** |
| Data export (full account) | Yes | Yes | No | **Moderate** |
| Passkeys (FIDO2/WebAuthn) | Yes | No | Clerk (if enabled) | **Minor** |
| In-app security settings UI | Yes | Limited | Clerk-managed (no in-app UI) | **Minor** |
| Per-device session management | Yes | Limited | Clerk (if enabled) | **Minor** |
| `/` slash command menu | Yes | Yes | No | **Major** |
| `@` mention for integrations | Yes | No | No | **Moderate** |
| Persistent action buttons in input | Yes (attach, search, voice) | Yes (attach) | Partial (attach, search) | **Minor** |

### 4b. Prioritized Gaps

#### P0 — Critical (Ship within 1-2 months)

These features close the most visible UX gaps and unlock the "universal AI interface" positioning. Item 1 (MCP) is the strategic priority and highest-impact work. Items 2-3 are small (0.5-2 days each) and should ship as a parallel UX polish sprint.

---

**1. MCP Integration into Chat Flow**

- **What competitors offer**: ChatGPT has an apps/connectors ecosystem (60+ apps on Business plan) and supports remote MCP servers/connectors; Claude supports connectors/MCP (e.g., Slack, Google Workspace). Both platforms are investing heavily in tool ecosystems.
- **Current state in Not A Wrapper**: MCP client utilities exist (`lib/mcp/load-mcp-from-local.ts`, `lib/mcp/load-mcp-from-url.ts`) using `@ai-sdk/mcp`, but they are **not wired into the chat flow**. The chat route has `tools: {} as ToolSet` (empty).
- **Recommended approach**: Wire the existing MCP client into the chat route. Load tool definitions from configured MCP servers and pass them to `streamText()`. Add a Connections settings UI (the tab already exists as a placeholder) where users can add MCP server URLs. Add a trust model: allowlist servers, require per-tool approvals by default, and log tool calls for auditability. The existing `tool-invocation.tsx` component already renders tool calls, so the UI is partially ready.
- **Serverless constraint**: The chat API runs on Vercel serverless functions. **Scope the initial implementation to SSE/Streamable HTTP MCP servers only** — stdio-based servers require persistent processes incompatible with serverless. Stdio support would require a local proxy, desktop app sidecar, or a separate long-running service (future work).
- **Estimated complexity**: Medium (2-3 weeks, accounting for serverless constraints)
- **Dependencies**: Settings UI for server configuration; user-level MCP server storage in Convex; SSE-only transport in v1.

---

**2. Drag and Drop File Upload (Implemented, needs polish)**

- **What competitors offer**: Both ChatGPT and Claude support dragging files directly onto the chat interface.
- **Current state in Not A Wrapper**: Drag-and-drop is already implemented globally via `FileUpload` and is wired in `ButtonFileUpload`. The drop overlay appears on drag. However, the file picker `accept` list only includes text + images, while validation allows PDF/CSV/JSON/Excel; this creates a UX mismatch.
- **Recommended approach**: Align the picker `accept` list with `lib/file-handling.ts` allowed types and consider a small affordance in the empty state to hint drag-and-drop. No backend changes required.
- **Estimated complexity**: Very small (0.5 day)
- **Dependencies**: None.

---

**3. Message Reactions / Feedback (Thumbs Up/Down)**

- **What competitors offer**: Both ChatGPT and Claude show thumbs up/down buttons on every assistant message. ChatGPT also allows written feedback. This data improves model selection and is a core UX convention users expect.
- **Current state in Not A Wrapper**: A general `feedback` table exists in Convex (`convex/feedback.ts`) but there is no per-message reaction system.
- **Recommended approach**: Add a `reactions` field to the `messages` table schema (or a new `messageReactions` table). Add thumbs up/down buttons to `message-assistant.tsx` next to the existing copy/regenerate buttons. Store reactions optimistically using the existing pattern from `lib/chat-store/`. Consider a "report bad response" flow for safety.
- **Estimated complexity**: Small (1-2 days)
- **Dependencies**: Convex schema migration for `messages` or new table.

---

**4. Conversation Export (Markdown, JSON, PDF)**

- **What competitors offer**: Neither competitor has strong native per-conversation export. ChatGPT offers account data export (Settings > Data Controls > Export Data) producing a `.zip` with `chat.html`. Claude offers account data export via Settings > Privacy with an email download link. Individual export on both platforms requires third-party browser extensions.
- **Current state in Not A Wrapper**: No export functionality exists. Share pages exist but only as public read-only URLs.
- **Why it's still P0**: Building per-conversation export would **leapfrog both competitors** on a feature users frequently request. It's also trivially easy given the existing message structure.
- **Recommended approach**: Add export buttons to the chat header dropdown. Generate Markdown from the existing `parts` message structure (which already contains structured text, code, reasoning). JSON export can serialize the raw message array directly from the messages provider. For PDF, start with an HTML export + browser "Print to PDF" flow, then add a PDF library if demand warrants.
- **Estimated complexity**: Small (1-2 days for Markdown + JSON; PDF follow-up if needed)
- **Dependencies**: None — all required data is already in the messages store and Convex.

---

#### P1 — Important (Ship within 3-6 months)

These features significantly improve retention and satisfaction. Users coming from ChatGPT or Claude will miss them.

---

**5. Code Execution Sandbox**

- **What competitors offer**: ChatGPT has a Python sandbox for data analysis, code execution, and chart generation. Claude's Artifacts can execute code interactively. Both can process datasets and visualize results.
- **Current state in Not A Wrapper**: No code execution capability.
- **Recommended approach**: Integrate a sandboxed code execution service. Options: (a) WebAssembly-based browser sandbox using Pyodide for Python or (b) server-side sandbox via E2B (open-source, designed for AI agents) or CodeSandbox SDK. Render results inline using a new `CodeExecutionResult` component alongside the existing `tool-invocation.tsx` pattern. Start with JavaScript/TypeScript execution (lower complexity) then add Python.
- **Estimated complexity**: Large (1+ month)
- **Dependencies**: Third-party sandbox service or WASM runtime; new tool definition for the AI SDK.

---

**6. Artifacts / Interactive Output Panel**

- **What competitors offer**: ChatGPT Canvas enables side-by-side document/code editing with version history. Claude Artifacts create interactive apps, visualizations, and documents that users can customize and share.
- **Current state in Not A Wrapper**: No artifact or canvas system.
- **Recommended approach**: Build a resizable side panel (similar to the existing `chat-preview-panel.tsx` pattern) that renders HTML/CSS/JS in a sandboxed iframe. Use a tool call convention (e.g., `createArtifact` tool) that the model calls to produce interactive content. Store artifacts as a new Convex table linked to messages. Enable sharing via existing public share infrastructure. Start simple: render static HTML/Markdown documents, then evolve to interactive React-based artifacts.
- **Estimated complexity**: Large (1+ month)
- **Dependencies**: Code execution sandbox (for interactive artifacts); new Convex table; iframe sandboxing.

---

**7. Cross-Conversation Memory**

- **What competitors offer**: ChatGPT stores memories automatically from conversations and via explicit "remember this" commands. Users can view, edit, and delete memories. Claude Pro has similar cross-conversation memory.
- **Current state in Not A Wrapper**: No memory system. Users have a `systemPrompt` field for custom instructions, but no automatic or explicit memory persistence.
- **Recommended approach**: Create a `memories` table in Convex with `userId`, `content`, `source` (auto/explicit), `createdAt`. Add a `memoryTool` to the AI SDK tool set that the model can call to store new memories. Inject relevant memories into the system prompt before each `streamText()` call. Use Convex's built-in vector search for semantic memory retrieval (the database already supports RAG). Add a Memory management page in Settings.
- **Estimated complexity**: Medium (1-2 weeks)
- **Dependencies**: Convex vector search setup; new tool definition; system prompt injection logic.

---

**8. Conversation Branching / Forking**

- **What competitors offer**: ChatGPT allows branching conversations from any message to explore alternative response paths. Dual conversations can be carried on simultaneously.
- **Current state in Not A Wrapper**: Message editing truncates and re-streams from the edit point (destructive). No way to preserve the original branch.
- **Recommended approach**: Modify the existing edit flow to optionally create a new chat (fork) instead of truncating. Copy messages up to the edit point into a new chat, then stream the new response. Add a `forkedFrom` field to the `chats` table to track lineage. The existing `ensureChatExists()` and `addBatch` mutation patterns handle the creation flow.
- **Estimated complexity**: Medium (1-2 weeks)
- **Dependencies**: Convex schema change for `chats` table; UI for fork action.

---

**9. Image Generation (via Provider APIs)**

- **What competitors offer**: ChatGPT has native image generation via GPT-4o. Users can generate and iteratively edit images within conversations.
- **Current state in Not A Wrapper**: No image generation. The infrastructure for displaying images exists (image search results grid is renderer-only; attachment previews work).
- **Recommended approach**: Since Not A Wrapper already connects to OpenAI, add image generation as a tool call. Use the OpenAI Images API (`dall-e-3` or the new GPT-4o image model) via the existing BYOK key system. Render generated images using the existing `search-images.tsx` pattern. Gating: require BYOK OpenAI key or Pro plan. This leverages existing provider infrastructure without building a generation engine.
- **Estimated complexity**: Medium (1-2 weeks)
- **Dependencies**: OpenAI API key (via BYOK); new tool definition; image result rendering component.

---

**10. Chat Archiving**

- **What competitors offer**: Both platforms support archiving conversations — hiding them from the main list without deletion.
- **Current state in Not A Wrapper**: Chats can only be deleted, not archived.
- **Recommended approach**: Add an `archived` boolean field and `archivedAt` timestamp to the `chats` table. Filter archived chats from the default sidebar query. Add an "Archived" section accessible from the sidebar or settings. Reuse the existing context menu pattern from `sidebar-item.tsx`.
- **Estimated complexity**: Small (1-2 days)
- **Dependencies**: Convex schema migration.

---

**11. Deep Research Mode**

- **What competitors offer**: ChatGPT Deep Research autonomously browses hundreds of sources over 5-30 minutes to produce comprehensive cited reports (usage limits by plan; Free 5, Plus/Team/Enterprise 25, Pro 250). Claude has Research mode for extended analysis (included in Pro tier). Both platforms feature deep research prominently — it's becoming a flagship capability.
- **Current state in Not A Wrapper**: Web search exists per-message but no multi-step research.
- **Why P1 (not P2)**: Deep research is now a headline feature on both major competitors and is included in their standard paid tiers. For a "universal AI interface," the inability to do multi-step research is a more noticeable gap than team workspaces or custom agents. It also builds directly on existing web search infrastructure and the MCP integration being prioritized at P0.
- **Recommended approach**: Build as an agent workflow using the existing web search infrastructure, but run it in a background job/queue to handle 5-30 minute tasks. Persist progress (steps + sources) and stream status updates to a progress UI component. Use a dedicated "research" system prompt that instructs the model to decompose queries, search iteratively, and synthesize. Leverage models with large context windows (Gemini 2.0, Claude Sonnet 4.5) for synthesis.
- **Estimated complexity**: Large (1+ month)
- **Dependencies**: MCP integration (for richer tool use); progress UI component.

---

**12. Enhanced Keyboard Shortcuts**

- **What competitors offer**: ChatGPT has 10+ keyboard shortcuts for common actions (copy conversation, toggle focus mode, voice input, etc.).
- **Current state in Not A Wrapper**: Only `Cmd+K` for command palette.
- **Recommended approach**: Add shortcuts for: new chat (`Cmd+N`), toggle sidebar (`Cmd+B`), toggle search (`Cmd+Shift+S`), focus input (`/`), copy last response (`Cmd+Shift+C`). Use the existing command palette infrastructure to register and discover shortcuts. Add a keyboard shortcut help dialog (`Cmd+/` or `?`).
- **Estimated complexity**: Small (1-2 days)
- **Dependencies**: None.

---

#### P2 — Nice to Have (6-12 month horizon)

These provide competitive differentiation but aren't adoption blockers.

---

**13. Team Workspaces**

- **What competitors offer**: ChatGPT Business/Enterprise and Claude Team/Enterprise offer shared workspaces with role-based access, shared projects, and admin controls.
- **Current state in Not A Wrapper**: Single-user only. Clerk supports organizations but no multi-tenant logic exists.
- **Recommended approach**: Leverage Clerk's organization features for team management. Add an `organizationId` field to chats, projects, and user preferences. Create team-level BYOK key pools. Add admin settings for team-wide model restrictions and usage limits.
- **Estimated complexity**: Large (1+ month)
- **Dependencies**: Clerk organization setup; Convex schema changes; new admin UI.

---

**14. Custom Agents / GPTs**

- **What competitors offer**: ChatGPT's GPT Builder lets users create custom agents with specific instructions, knowledge bases, and tool access. The GPT Store has thousands of community-created agents.
- **Current state in Not A Wrapper**: No production custom-agent architecture exists.
- **Recommended approach**: Start from a clean design: name, system prompt, model selection, optional knowledge files using Convex storage. Store agent configs in a new `agents` table. Allow users to select agents like they select models. Community sharing can reuse the existing public share infrastructure.
- **Estimated complexity**: Large (1+ month)
- **Dependencies**: Sub-agent architecture implementation; knowledge file RAG.

---

**15. Audio Input/Output (Voice Mode)**

- **What competitors offer**: ChatGPT has real-time voice mode with emotive speech synthesis across web, desktop, and mobile.
- **Current state in Not A Wrapper**: No audio capabilities.
- **Recommended approach**: Use the Web Speech API for speech-to-text input (browser-native, no backend needed). For output, integrate a TTS provider (OpenAI's TTS API, ElevenLabs, or browser-native `SpeechSynthesis`). Add a microphone button to the chat input. Voice mode can be a toggle that auto-submits after speech ends.
- **Estimated complexity**: Medium (1-2 weeks)
- **Dependencies**: TTS provider API key (via BYOK or platform); browser API compatibility.

---

**16. Onboarding Flow**

- **What competitors offer**: Both ChatGPT and Claude have first-time user flows explaining capabilities, model selection, and key features.
- **Current state in Not A Wrapper**: No onboarding. Users land directly in the chat interface.
- **Recommended approach**: Build a lightweight 3-4 step onboarding modal: (1) Welcome + choose theme, (2) Select preferred model, (3) Optional BYOK key setup, (4) Feature highlights (multi-model, web search, projects). Store `onboardingCompleted` in user preferences. Show only once.
- **Estimated complexity**: Small (1-2 days)
- **Dependencies**: None.

---

### 4c. Unique Strengths

Not A Wrapper has **six distinct competitive advantages** that neither ChatGPT nor Claude can match:

| Strength | Why It Matters | How to Lean In |
|----------|---------------|----------------|
| **Multi-Model Comparison** | No other platform lets users compare 10 models side-by-side on the same prompt. This is uniquely valuable for developers evaluating models, researchers benchmarking, and power users optimizing. | Add comparison analytics (token count, latency, cost per response). Allow saving comparison results. Create a "Model Arena" feature for blind comparisons with voting. |
| **BYOK (Bring Your Own Key)** | Enterprise users and privacy-conscious individuals can use their own API keys with zero data passing through third-party servers. AES-256-GCM encryption is enterprise-grade. | Highlight cost savings (vs. $20-200/mo subscriptions). Show estimated cost per conversation. Add BYOK for more providers (Cohere, Together AI). Enterprise: team-level key pools. |
| **100+ Models / 10 Providers** | ChatGPT locks users to OpenAI models. Claude locks users to Anthropic models. Not A Wrapper is the universal interface — try any model without separate accounts. | Build a model recommendation engine ("best model for coding", "best for creative writing"). Show model capability comparisons. Add new providers quickly via the established skill system. |
| **Open Source** | Full transparency, community contributions, no vendor lock-in. No other major AI chat app offers this combination of features as open source. | Invest in documentation, contribution guides, and community. Accept PRs for new providers and features. Offer a managed hosted version. Create a plugin/extension system for community-built features. |
| **Command Palette (Cmd+K)** | Neither ChatGPT nor Claude has a command palette. Power users love keyboard-driven interfaces. | Expand to include actions (new chat, toggle search, switch model, change theme) beyond just chat search. Make it the central command hub. |

### 4d. Strategic Recommendations

**1. "Universal AI Interface" Positioning**

Not A Wrapper should not try to clone ChatGPT or Claude feature-for-feature. Instead, lean into the positioning of being the **one interface for all AI** — the place where users come because they want choice, transparency, and control. Every feature decision should pass the test: "Does this reinforce our multi-provider, user-first identity?"

**Action**: Frame marketing around "One app. Every AI model. Your keys." Focus roadmap on cross-model features (comparison, routing, memory that works across providers) rather than single-provider features.

---

**2. MCP as the Integration Layer (Build vs. Integrate)**

Rather than building native integrations for Google Drive, GitHub, Slack, etc. (which would require enormous ongoing maintenance), leverage MCP as the universal integration protocol. Not A Wrapper already has MCP client code — wiring it into the chat flow and adding a configuration UI would instantly enable hundreds of community MCP servers. This is the single most strategically important feature to ship.

**Action**: Complete MCP integration (P0 #1) and position it as a core differentiator: "Connect any tool via MCP — no walled garden." Build a curated MCP server directory. Start with SSE/Streamable HTTP transport only (serverless-compatible). Default to allowlists and per-tool approvals with audit logging to mitigate tool risks. This aligns with open-source values and scales via community.

---

**3. Ship the "UX Polish Sprint" Immediately (Drag & Drop polish, Reactions, Export)**

These P0 items are small complexity. Reactions/export are missing, and drag-and-drop needs minor UX/picker alignment. Ship them in parallel with MCP work to bring the product to baseline parity in the areas users most commonly notice. Note: per-conversation export would actually **leapfrog** both ChatGPT and Claude, neither of which offers native per-conversation export (both only have bulk data exports).

**Action**: Prioritize drag-and-drop polish (accept list + affordance), thumbs up/down reactions, and export (Markdown + JSON first; PDF follow-up if needed) as a single 1-week sprint.

---

**4. Artifacts as the "Killer Feature" for Multi-Model**

Artifacts are transformational in Claude and Canvas in ChatGPT. For Not A Wrapper, the unique twist is: **artifacts that work with any model**. Users could generate an artifact with Claude, then iterate on it with GPT-5, then refine with Gemini — all in the same panel. No other tool enables this.

**Action**: Prioritize a basic artifact system (P1) that renders HTML/Markdown/code in a side panel. Design it model-agnostic from day one. This becomes the crown jewel of the "universal AI interface" narrative.

---

**5. Open Source Community as a Feature Multiplier**

ChatGPT has hundreds of engineers building features. Not A Wrapper can match output by building the right extension points for community contributions. The skills system, MCP integration, and model provider abstraction are already excellent extension points.

**Action**: Create a contributor guide specifically for: (a) adding new AI providers, (b) building MCP tool servers, (c) creating artifact templates. Host community "model of the month" additions. Accept PRs for the simpler P1/P2 features.

---

**6. Invest in the "AI Power User" Persona**

ChatGPT is optimizing for mainstream consumers. Claude is optimizing for professional workflows. Not A Wrapper's natural audience is the **AI power user** — developers, researchers, and enthusiasts who want control, comparison, and customization. Every feature should serve this persona first.

**Action**: Prioritize features that power users care about: keyboard shortcuts, export, BYOK cost tracking, model comparison analytics, local model support. De-prioritize consumer features like voice mode and accent color customization.

---

**7. Model-Agnostic Memory as Strategic Differentiation**

Both ChatGPT and Claude memory systems are locked to their respective providers. Not A Wrapper could build **memory that works across all models** — your preferences, facts, and context travel with you regardless of which model you're talking to. This is a powerful retention mechanism and genuine innovation.

**Action**: Build memory (P1) using Convex's built-in vector search for semantic retrieval. Store memories provider-agnostically. Inject relevant memories into any model's system prompt. This becomes a moat: once users build up memory in Not A Wrapper, switching cost is high.

---

**8. BYOK + Tools: Define the Billing & Access Model**

Several planned features (image generation, code execution, MCP tools, deep research) consume API credits or require specific provider keys. The current BYOK model works well for chat, but tool-based features introduce new questions: Who pays for tool calls? How do you rate-limit tool usage separately from chat? What happens when a user's BYOK key doesn't support a needed tool (e.g., image generation requires an OpenAI key, but the user only has an Anthropic key)?

**Action**: Design a clear access model before building P1 tool-dependent features. Options include: (a) all tool calls use the user's BYOK key for the relevant provider, (b) platform-subsidized tools on the Pro plan, (c) hybrid where users can choose. Document this as an ADR in `.agents/research/`.

---

**9. Monetization Strategy in a $8/mo World**

ChatGPT now offers six tiers from Free to Enterprise, including a Go plan at **$8/mo** (with ads). Claude has Free, Pro ($20/mo), and Max ($100-200/mo). Not A Wrapper's pricing strategy needs to account for this landscape. The open-source model is a strength, but the managed hosted version needs a clear value proposition at a competitive price point.

**Action**: Define pricing tiers for the managed hosted version. Consider: Free (limited models, rate-limited) → Pro ($X/mo, all models, higher limits, export, MCP) → Team ($Y/user/mo, shared BYOK pools, admin controls). The BYOK model is a natural differentiator — users who bring their own keys pay less because they're covering API costs directly.

---

## 5. Appendix: Feature Detail Cards

### Card 1: Conversation Export

| Field | Detail |
|-------|--------|
| **Gap Level** | P0 — Critical (leapfrog opportunity) |
| **Competitors** | ChatGPT: Account data export only (Settings > Data Controls > zip with `chat.html`); no native per-conversation export — requires third-party extensions. Claude: Account data export via Settings > Privacy (email download link). Neither has native per-conversation PDF/MD export. |
| **Current State** | No export. Messages stored in Convex (`convex/messages.ts`) with `parts` array (AI SDK format). Share pages render messages server-side. |
| **Technical Approach** | Add `ExportMenu` dropdown to chat header. Markdown: iterate `parts`, render text/code/reasoning into Markdown string. JSON: serialize messages array directly. PDF: start with HTML export + browser "Print to PDF"; consider a PDF library later if demand warrants. |
| **Files to Modify** | `app/components/chat/chat.tsx` (header), new `lib/export/` utilities, `app/components/chat/export-menu.tsx` |
| **Complexity** | Small (1-2 days for Markdown + JSON; PDF follow-up if needed) |

### Card 2: Message Reactions

| Field | Detail |
|-------|--------|
| **Gap Level** | P0 — Critical |
| **Competitors** | Both ChatGPT and Claude show thumbs up/down on every assistant message. ChatGPT also allows written feedback and model correction. |
| **Current State** | General `feedback` table exists but no per-message reactions. `message-assistant.tsx` has copy and regenerate buttons in the action bar. |
| **Technical Approach** | Add `messageReactions` table: `{ messageId, chatId, userId, reaction: "up" | "down", createdAt }`. Add thumbs buttons to `message-assistant.tsx` action bar. Optimistic updates using existing pattern. Optional: "Tell us more" dialog on thumbs down. |
| **Files to Modify** | `convex/schema.ts`, new `convex/reactions.ts`, `app/components/chat/message-assistant.tsx` |
| **Complexity** | Small (1-2 days) |

### Card 3: MCP Chat Integration

| Field | Detail |
|-------|--------|
| **Gap Level** | P0 — Critical |
| **Competitors** | ChatGPT: apps/connectors ecosystem (60+ apps on Business plan) and remote MCP servers. Claude: connectors/MCP (e.g., Slack, Google Workspace). Both use MCP as the underlying protocol. |
| **Current State** | `lib/mcp/load-mcp-from-local.ts` and `lib/mcp/load-mcp-from-url.ts` exist with working `createMCPClient()` implementations. Not wired into `app/api/chat/route.ts` — tools are `{} as ToolSet`. Settings Connections tab is a placeholder. |
| **Technical Approach** | (1) Add `mcpServers` table in Convex: `{ userId, name, url, transport: "sse" | "streamable-http" }`. (2) Build Connections settings UI to add/remove MCP servers. (3) In chat route, load user's MCP servers, create clients, aggregate tools into the `tools` parameter for `streamText()`. (4) Add an allowlist + per-tool approval model and log tool calls for auditability. (5) Tool results already render via `tool-invocation.tsx`. **Note**: V1 scoped to SSE/Streamable HTTP only — stdio requires persistent processes incompatible with Vercel serverless. |
| **Files to Modify** | `convex/schema.ts`, new `convex/mcpServers.ts`, `app/api/chat/route.ts`, `app/components/layout/settings/connections-tab.tsx` |
| **Complexity** | Medium (2-3 weeks, accounting for serverless constraints) |

### Card 4: Code Execution Sandbox

| Field | Detail |
|-------|--------|
| **Gap Level** | P1 — Important |
| **Competitors** | ChatGPT: Python sandbox for data analysis, charts, file processing (file limits apply; 512MB per file, 10GB user cap). Claude: Code execution in Artifacts with live preview. |
| **Current State** | No code execution. Code is only rendered with syntax highlighting. |
| **Technical Approach** | Option A (recommended): Integrate E2B (open-source, AI-native sandbox). Create a `codeExecution` tool definition for the AI SDK. On tool call, send code to E2B, return stdout/stderr/files. Render results in a new `CodeResult` component. Option B: Browser-side WASM (Pyodide for Python, QuickJS for JS) — lower latency but limited capabilities. |
| **Files to Modify** | New `lib/tools/code-execution.ts`, new `app/components/chat/code-result.tsx`, `app/api/chat/route.ts` (add tool) |
| **Complexity** | Large (1+ month) |

### Card 5: Artifacts / Interactive Output Panel

| Field | Detail |
|-------|--------|
| **Gap Level** | P1 — Important |
| **Competitors** | ChatGPT Canvas: Side-by-side editor for documents and code with version history, shortcuts, collaborative editing. Claude Artifacts: Interactive apps, documents, and visualizations with MCP integration and sharing. |
| **Current State** | No artifact system. `chat-preview-panel.tsx` exists as a conversation preview side panel — similar layout pattern. |
| **Technical Approach** | (1) New `artifacts` Convex table: `{ chatId, messageId, type, content, title, version }`. (2) Resizable side panel component (extend `chat-preview-panel.tsx` pattern). (3) Sandboxed iframe for rendering HTML/CSS/JS artifacts. (4) `createArtifact` tool definition that models can call. (5) Version history using Convex's built-in document versioning. (6) **Unique angle**: Artifacts work with any model — generate with Claude, iterate with GPT-5. |
| **Files to Modify** | `convex/schema.ts`, new `convex/artifacts.ts`, new `app/components/chat/artifact-panel.tsx`, `app/api/chat/route.ts` |
| **Complexity** | Large (1+ month) |

### Card 6: Cross-Conversation Memory

| Field | Detail |
|-------|--------|
| **Gap Level** | P1 — Important |
| **Competitors** | ChatGPT: Automatic + explicit memory. Saved memories and chat history insights. Management UI for viewing/editing/deleting. Available on all tiers. Claude: Memory on Pro plans. Cross-conversation context persistence. |
| **Current State** | No memory system. `systemPrompt` in `users` table is the closest analog (manual custom instructions). Convex supports vector search natively (built-in RAG mentioned in AGENTS.md). |
| **Technical Approach** | (1) New `memories` table: `{ userId, content, source: "auto" | "explicit", embedding, createdAt }`. (2) `memoryTool` for AI SDK: model calls to store/recall memories. (3) On each chat request, vector-search top-K relevant memories and inject into system prompt. (4) Memory management page in Settings. (5) **Unique**: Memories work across all models — your context travels with you. |
| **Files to Modify** | `convex/schema.ts`, new `convex/memories.ts`, `app/api/chat/route.ts` (memory injection), new settings page |
| **Complexity** | Medium (1-2 weeks) |

---

*Analysis produced February 6, 2026. Updated February 7, 2026 (added: ChatGPT push/email notifications with per-category controls, granular personalization settings — base style & tone, characteristics, profile info, record mode, per-feature toggles — developer mode for unverified connectors, dedicated schedules management UI, orders/shopping capability, comprehensive data controls — training opt-out, remote browser data, shared links management, bulk archive/delete — and account security features — passkeys, MFA, per-device session management; expanded sections 2.6, 2.7, 2.13; added new sections 2.14 Notifications, 2.15 Data Controls & Privacy, 2.16 Account Security; updated gap analysis matrix and NaW inventory). Updated February 7, 2026 (added: section 2.17 Prompt Box Interaction Patterns — `/` slash command menu, `@` mention system, persistent action buttons, prompt box architecture diagrams for both ChatGPT and Claude; added Prompt Box Patterns to NaW inventory and gap analysis matrix; based on user-provided screenshots of ChatGPT and Claude prompt UX). Based on publicly available features and the Not A Wrapper codebase at current commit.*

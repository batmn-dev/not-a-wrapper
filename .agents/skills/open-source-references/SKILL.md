---
name: open-source-references
description: Route Not A Wrapper AI chat research, evaluation, review, planning, and implementation to focused open-source reference implementations. Use when work concerns streaming and rendering, durable generations, conversation persistence or message UX, providers and models, tools and agents, MCP, search and citations, files and RAG, projects, auth and permissions, BYOK, local models, composer UX, Next.js and AI SDK, Convex-backed chat, or admin and extensibility architecture, and mature external implementations could provide useful evidence; do not use for unrelated generic application code.
---

# Open-source AI chat reference router

Use this skill as a routing index, not as an architecture source or research
report. Inspect Not A Wrapper first, define the exact question, and follow its
`AGENTS.md`. Use reference implementations to find proven patterns, expose edge
cases, and challenge an approach; never recommend copying a pattern merely
because another project uses it.

Keep the Convex and AI SDK skills authoritative for current first-party
guidance. Use these repositories as complementary implementation evidence.

For product behavior, interaction, or visual parity, inspect the user's existing
authenticated ChatGPT session first. If it is unavailable, use checked-in
ChatGPT reference artifacts and state that fallback. Do not let an open-source
implementation override behavior observed in ChatGPT.

Resolve local clones by exact directory name. First check
`NAW_REFERENCE_ROOT/<clone>` when `NAW_REFERENCE_ROOT` is configured; otherwise
check available workspace roots and siblings of the current Not A Wrapper
worktree. Use a local directory only when it is a Git worktree whose origin
matches the repository targeted by the row's GitHub fallback, allowing for
SSH/HTTPS URL forms and GitHub redirects. If no matching clone is available,
use the GitHub fallback.

| Question                                                                      | Local clone (if available) | GitHub fallback                                               | Use as evidence for                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js, App Router, or Vercel AI SDK                                         | `VercelChatbot`            | [Vercel Chatbot](https://github.com/vercel/ai-chatbot)        | Streaming, tools, generative UI, persistence, auth, and attachments; verify durability and recovery behavior                                     |
| Broad providers, agents, MCP, or production architecture                      | `LibreChat`                | [LibreChat](https://github.com/danny-avila/LibreChat)         | Backend breadth, provider configuration, auth, files, search, RAG, and persistence; do not treat it as the default visual reference              |
| Coding-agent control surfaces, multi-provider orchestration, or remote access | `T3Code`                   | [T3 Code](https://github.com/pingdotgg/t3code)                | Agent-session UX, provider adapters, event-sourced orchestration, approvals, worktrees, checkpoints, source control, and cross-device resilience |
| Multi-user cloud agents, shared workspaces, or organizational governance      | `QM`                       | [QM](https://github.com/yc-software/qm)                       | Scope isolation, durable runs, harness routing, credential grants, skill governance, background work, agent-built apps, and operator-owned deployment |
| Design agents, artifact generation, design systems, or skill/plugin architecture | `open-design`           | [OpenDesign](https://github.com/nexu-io/open-design)          | Multi-agent adapters, composable skills, `DESIGN.md` context, sandboxed previews, artifact streaming, critique, and export workflows             |
| Product design, agent UX, settings, or knowledge UX                           | `LobeHub`                  | [LobeHub](https://github.com/lobehub/lobehub)                 | Agent discovery, tools and plugins, model management, design-system organization, and extensibility                                              |
| Local models, self-hosting, admin, or permissions                             | `OpenWebUI`                | [Open WebUI](https://github.com/open-webui/open-webui)        | Model administration, multi-user controls, RAG, extensions, compatible APIs, and operations                                                      |
| Workspaces, document ingestion, RAG, or local agents                          | `AnythingLLM`              | [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)  | Workspace and knowledge workflows, permissions, scheduled work, and local-first deployment                                                       |
| Lean OpenAI-compatible chat architecture                                      | `HuggingChat`              | [HuggingChat Chat UI](https://github.com/huggingface/chat-ui) | Smaller conversation UI and model-gateway boundaries that clarify necessary abstractions                                                         |

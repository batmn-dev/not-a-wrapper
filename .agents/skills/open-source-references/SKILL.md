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


| Question                                                        | Inspect first                                         | GitHub fallback                                               | Use as evidence for                                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Next.js, App Router, or Vercel AI SDK                           | `/Users/andresgonzalez/Github/Projects/VercelChatbot` | [Vercel Chatbot](https://github.com/vercel/ai-chatbot)        | Streaming, tools, generative UI, persistence, auth, and attachments; verify durability and recovery behavior                        |
| Broad providers, agents, MCP, or production architecture        | `/Users/andresgonzalez/Github/Projects/LibreChat`     | [LibreChat](https://github.com/danny-avila/LibreChat)         | Backend breadth, provider configuration, auth, files, search, RAG, and persistence; do not treat it as the default visual reference |
| Product design, agent UX, settings, or knowledge UX             | `/Users/andresgonzalez/Github/Projects/LobeHub`       | [LobeHub](https://github.com/lobehub/lobehub)                 | Agent discovery, tools and plugins, model management, design-system organization, and extensibility                                 |
| Local models, self-hosting, admin, or permissions               | `/Users/andresgonzalez/Github/Projects/OpenWebUI`     | [Open WebUI](https://github.com/open-webui/open-webui)        | Model administration, multi-user controls, RAG, extensions, compatible APIs, and operations                                         |
| Workspaces, document ingestion, RAG, or local agents            | `/Users/andresgonzalez/Github/Projects/AnythingLLM`   | [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)  | Workspace and knowledge workflows, permissions, scheduled work, and local-first deployment                                          |
| Lean OpenAI-compatible chat architecture                        | `/Users/andresgonzalez/Github/Projects/HuggingChat`   | [HuggingChat Chat UI](https://github.com/huggingface/chat-ui) | Smaller conversation UI and model-gateway boundaries that clarify necessary abstractions                                            |
| Convex, durable streaming, reload recovery, BYOK, or OpenRouter | `/Users/andresgonzalez/Github/Projects/ThomChat`      | [Thom Chat](https://github.com/TGlide/thom-chat)              | Specialized secondary evidence from a smaller T3 Chat-inspired implementation; acknowledge its narrower production history          |

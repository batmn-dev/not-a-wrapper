---
name: ai-sdk-v7
description: Route AI SDK v7 questions about streamText, useChat, UI messages, tools, approvals, loop control, structured output, reasoning, context, cancellation, errors, providers, and migrations to current official docs while checking repository-local versions.
---

# AI SDK v7 documentation router

Use this skill as a routing index, not an implementation playbook. Official docs
track the latest release; before applying their examples or API guidance, verify
this repository's declared versions in `package.json`, exact resolutions in
`bun.lock`, and available APIs in the installed package types. Follow
`AGENTS.md` for repository-specific rules.

1. If you need help with text generation or `streamText`, go here: [Generating and Streaming Text](https://ai-sdk.dev/docs/ai-sdk-core/generating-text) and [`streamText` reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text).
2. If you need help producing or consuming UI message streams, go here: [Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol).
3. If you need help building chat state with `useChat`, go here: [`useChat` reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat).
4. If you need help converting UI messages for a model call, go here: [`convertToModelMessages` reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/convert-to-model-messages).
5. If you need help defining tools or handling tool calls, go here: [Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
6. If you need help controlling multi-step tool loops, stopping conditions, per-step settings, or usage-aware budgets, go here: [Loop Control](https://ai-sdk.dev/docs/agents/loop-control).
7. If you need help requiring or responding to tool approvals, go here: [Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals).
8. If you need help generating schema-constrained output, go here: [Generating Structured Data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data).
9. If you need help configuring or exposing model reasoning, go here: [Reasoning](https://ai-sdk.dev/docs/ai-sdk-core/reasoning).
10. If you need help passing runtime state or tool-only context, go here: [Runtime and Tool Context](https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context).
11. If you need help with retries or generation timeouts, go here: [Settings](https://ai-sdk.dev/docs/ai-sdk-core/settings).
12. If you need help with cancellation or abort signals, go here: [Stopping Streams](https://ai-sdk.dev/docs/advanced/stopping-streams).
13. If you need help handling generation errors, stream error parts, abort-specific cleanup, or terminal callbacks, go here: [Error Handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling) and [onFinish not called when stream is aborted](https://ai-sdk.dev/docs/troubleshooting/stream-abort-handling).
14. If you need help choosing a provider or checking model feature support, go here: [Providers and Models](https://ai-sdk.dev/docs/foundations/providers-and-models) and the [provider compatibility directory](https://ai-sdk.dev/providers/ai-sdk-providers).
15. If you need help centralizing model aliases, provider registries, fallbacks, default settings, or middleware, go here: [Provider & Model Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management).
16. If you need help migrating to v7 or replacing deprecated APIs, go here: [Migrate AI SDK 6.x to 7.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0).

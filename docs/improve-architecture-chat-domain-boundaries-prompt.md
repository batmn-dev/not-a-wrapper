# Prompt template: architecture pass biased toward chat-domain boundaries

> Copy-paste the block below as-is. It names areas by role rather than exact shape, so it stays valid as the code evolves.

---

Invoke the improve-codebase-architecture skill with a bias toward the blurry layering of the chat turn domain, which is currently spread across `app/components/chat`, `lib/chat-store`, `lib/chat-messages`, `lib/tools`, and `app/api/chat`, with several same-named "turn" concepts living in different layers. Focus on settling what the layers actually are (client projection, durable contract, server runtime, shared domain), then sharpening names and file placement so each boundary is legible — while respecting deliberate seams documented in the ADRs (e.g. client-renders-server-selected-path) rather than flattening them. Update CONTEXT.md and the ADRs inline as the domain language crystallizes, and prefer moving code to match the settled boundaries over introducing new parallel abstractions.

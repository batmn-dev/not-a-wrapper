# Not A Wrapper

Domain language for the multi-AI chat app: one chat surface, many model providers, with tools layered on top of every conversation.

## Language

### Tools

**Tool runtime**:
Everything a chat request needs to use tools, prepared once per request and alive for the whole stream: the merged tool set, per-tool metadata, step gating, and budget accounting.
_Avoid_: tool coordinator, tool orchestrator, tool loader

**Tool layer**:
One of the sources tools come from — Layer 1 (provider-native), Layer 2 (Exa search/content fallback), Layer 3 (user-configured MCP servers). Layers are merged into the tool runtime; later layers win name collisions.
_Avoid_: tool source (reserved for the per-tool metadata field), tier

**Capability policy**:
The per-request decision of which tool capabilities (search, extract, mcp, code) a user/model/key combination may use, and which specific tools are allowed in early vs late steps.
_Avoid_: permissions, feature flags

**Tool budget**:
The per-tool call allowance enforced during a request — probed before provider-executed calls, consumed after execution, degrading to a request-local soft cap when the policy store is unreachable.
_Avoid_: rate limit, quota

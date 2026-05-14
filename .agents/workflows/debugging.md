# Workflow: Debugging Issues

Systematic approach to debugging problems in Not A Wrapper.

## Prerequisites

- [ ] Issue is reproducible
- [ ] You can run dev server locally
- [ ] Browser dev tools available

## Step 1: Identify the Layer

Determine where the issue originates:

| Symptom | Likely Layer | First Check |
|---------|--------------|-------------|
| UI not updating | State/React | Component re-renders |
| 500 error | API/Server | API route logs |
| Data not saving | Database/Convex | Convex dashboard |
| Auth issues | Middleware/Clerk | middleware.ts |
| Streaming broken | AI SDK | toUIMessageStreamResponse |

## Step 2: Gather Information

### For UI Issues

```bash
# Check browser console
# Check React DevTools
# Check Network tab for failed requests
```

### For API Issues

```bash
# Check terminal running dev server
# Look for error stack traces
```

### For Database Issues

```bash
# Check Convex dashboard: https://dashboard.convex.dev
# Look at function logs
# Check for failed mutations
```

### For Type Issues

```bash
bun run typecheck 2>&1 | head -50
```

## Step 3: Isolate the Problem

### Streaming Response Issues

```typescript
// Check API route returns correct format (AI SDK v6)
return result.toUIMessageStreamResponse({
  sendReasoning: true,
  sendSources: true,
  onError: (error) => extractErrorMessage(error),  // Must sanitize
})

// Never return regular Response for streaming
// ❌ return new Response(...)
```

### State Not Updating

```typescript
// Check optimistic update pattern
let previous = null
setState((prev) => {
  previous = prev  // Save for rollback
  return updated
})

// Check useCallback/useMemo dependencies
const callback = useCallback(() => {
  // Check all variables used are in deps
}, [dep1, dep2])  // Missing dep = stale closure
```

### Convex Function Errors

```typescript
// Check auth pattern
const identity = await ctx.auth.getUserIdentity()
if (!identity) throw new Error("Not authenticated")

// Check index usage
.withIndex("by_user", (q) => q.eq("userId", user._id))
// NOT .filter() for indexed fields

// Check cascade deletes
// Delete children before parent
```

### BYOK Not Working

```typescript
// Check env.ts — user keys override defaults per provider
export function createEnvWithUserKeys(userKeys: Record<string, string> = {}) {
  return {
    OPENAI_API_KEY: userKeys.openai || env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: userKeys.anthropic || env.ANTHROPIC_API_KEY,
    // ... each provider has explicit mapping
  }
}

// Common issues:
// - userKeys key doesn't match provider ID (e.g., "claude" vs "anthropic")
// - API key not passed through from user-keys API
```

## Step 4: Apply Fix

### Hierarchy of Solutions

1. **Fix the code** — Always first choice
2. **Refactor the pattern** — If fundamentally wrong
3. **Document exception** — With approval only

### Never

- Add `// @ts-ignore`
- Disable ESLint rules
- Skip auth checks
- Return raw errors to client

## Step 5: Verify Fix

```bash
# Run checks
bun run typecheck
bun run lint
bun run test

# Manual verification
# - Issue no longer reproduces
# - No new issues introduced
# - No console errors
```

## Common Issues

### "Not authenticated" on valid session

- Check Clerk middleware config
- Verify ConvexProviderWithClerk setup
- Check JWT issuer domain matches

### "Provider not found" for model

- Check MODEL_PROVIDER_MAP in provider-map.ts
- Verify model ID matches exactly
- Check getProviderForModel() pattern matching

### Streaming hangs

- Check rate limiting happens BEFORE streamText()
- Verify model supports streaming
- Check API key is valid

### Optimistic update shows then disappears

- Server state overwrote optimistic
- Check merge logic in useMemo
- Ensure optimistic IDs don't conflict

### Type errors after Convex change

```bash
# Regenerate Convex types
npx convex dev
# Or restart convex process
```

## Reference

- `CLAUDE.md` — Debugging workflow section
- `.cursor/rules/040-security.mdc` — Security patterns
- `.agents/project/README.md` — System overview

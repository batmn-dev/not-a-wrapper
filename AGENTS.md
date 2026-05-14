# Not A Wrapper

Open-source multi-AI chat app with a unified model interface across providers.

## Primary Objective

Deliver correct, maintainable, well-researched, best practice changes.

## Implementation Philosophy (SHOULD)

- Prefer well-researched, industry-standard solutions over quick fixes.
- Extend existing project patterns instead of introducing parallel systems.
- Fix root causes instead of symptoms.
- Optimize for maintainability and clarity over short-term speed.
- If unsure, consult `.agents/research/` and document non-trivial trade-offs.

## Correctness-First Escalation (MUST)

- Use risk-based rigor: keep low-risk tasks lightweight, increase rigor for medium/high-risk tasks.
- Medium/high-risk changes require a brief approach decision before coding (options, trade-offs, chosen approach).
- High-risk triggers include: auth, schema/data model, API contracts, persistence, concurrency, migrations, billing/payments, and security-critical paths.
- Introducing a new dependency or architectural pattern requires explicit justification and at least one alternative considered.
- Validation depth must scale with risk; do not treat successful compilation as sufficient evidence of correctness.
- For the detailed process, load `.agents/workflows/correctness-decision-workflow.md` on demand.

## Non-Negotiable Rules

### Security (MUST)

- Never log or expose secrets, tokens, or credentials.
- Treat BYOK/API key data as encrypted-at-rest.

### Code Quality (MUST)

- No `// @ts-ignore`.
- No lint-rule bypassing (`eslint-disable`) without explicit documented approval.
- Do not downgrade or disable checks to "make it pass."
- Prefer source fixes over workarounds.

### Git Safety (MUST)

- Never create branches unless explicitly asked.
- Never force-push to shared branches.
- Avoid destructive git commands unless explicitly requested.

## Ask Before Making These Changes (MUST)

- Adding dependencies (`bun add ...`)
- Modifying `package.json`, `tsconfig*`, `next.config.*`
- Editing auth-critical paths (`app/auth/`, `middleware.ts`)
- Changing DB schema (`convex/schema.ts`)
- Changing CI/CD (`.github/workflows/`)
- Deleting files

## Required Project Patterns (MUST When Applicable)

### Streaming Responses (AI SDK v6)

```typescript
return result.toUIMessageStreamResponse({
  sendReasoning: true,
  sendSources: true,
  onError: (error) => extractErrorMessage(error),
})
```

### Convex Auth Pattern

```typescript
const identity = await ctx.auth.getUserIdentity()
if (!identity) throw new Error("Not authenticated")
// verify ownership before user-scoped mutations
```

### Optimistic Update Pattern

```typescript
let previous = null
setState((prev) => {
  previous = prev
  return updated
})
try {
  await mutation()
} catch {
  if (previous) setState(previous)
}
```

## On-Demand Context

Load only when needed:

- `.agents/skills/`
- `.agents/workflows/`
- `.agents/troubleshooting/`
- `.agents/research/`
- `README.md` and `INSTALL.md`

## Output Preferences (SHOULD)

- If asked to create a prompt, return it directly in chat unless a file is explicitly requested.
- Do not include timeline or effort estimates unless explicitly requested.

## Pull Request Baseline (SHOULD When Preparing PRs)

1. Run `git fetch origin` before branch comparisons.
2. Diff and log against `origin/main` (not local `main`).
3. Scope PR descriptions to commits in `origin/main..HEAD`.

# Not A Wrapper

Open-source multi-AI chat app with a unified model interface across providers.

## Primary Objective

Deliver correct, maintainable, well-researched, best practice changes.

## Pre-Launch: The Database Is Disposable (MUST)

This project has **no users and no production data**. The development database is
disposable. Do not spend effort protecting data that does not exist.

- Change `convex/schema.ts` directly: add, remove, rename, retype, or narrow
  fields as the design needs. **No** expand/migrate/contract, **no** migration
  manifests, **no** field-removal ceremony.
- If existing dev data conflicts with a schema change, wipe it (Convex dashboard
  or a one-off `bunx convex run`/clear) and move on. Losing dev data is not a risk.
- Schema and data-model changes are **not** high-risk and require **no** approval
  gate while pre-launch.
- The expand/migrate/contract workflow (`docs/convex-migrations.md`), the
  migration manifests (`convex/migrations/`), and the schema-guard / deploy
  preflight tooling are **dormant** until launch. Do not re-introduce them for a
  schema change.

Scope: **the database only.** This does NOT relax working-tree/file hygiene (do
not delete user-owned or untracked files — see "Dirty Worktree And Generated
Files"), secret handling (never log secrets; treat BYOK keys as
encrypted-at-rest), or auth correctness.

When the app gains real users, revert this section and re-activate the migration
discipline.

## Implementation Philosophy (SHOULD)

- Prefer well-researched, industry-standard solutions over quick fixes.
- Extend existing project patterns instead of introducing parallel systems.
- Fix root causes instead of symptoms.
- Optimize for maintainability and clarity over short-term speed.
- If unsure, consult repo-local docs, remaining `.agents/skills/`, and official references; document non-trivial trade-offs.

## Product Pattern Consistency (MUST)

- When extending an existing feature to a new state, audience, or route, identify the current source-of-truth pattern before editing. Match its component ownership, placement logic, visual weight, and interaction model by default.
- Do not solve local layout or state-specific constraints with one-off styling that makes equivalent functionality feel like a different product. If consistency conflicts with another requirement, state the trade-off before coding and preserve the established product pattern unless instructed otherwise.

## Correctness-First Escalation (MUST)

- Use risk-based rigor: keep low-risk tasks lightweight, increase rigor for medium/high-risk tasks.
- Medium/high-risk changes require a brief approach decision before coding (options, trade-offs, chosen approach).
- High-risk triggers include: auth, API contracts, concurrency, billing/payments, and security-critical paths. (Database schema, data model, and migrations are NOT high-risk pre-launch — see "Pre-Launch: The Database Is Disposable".)
- Introducing a new dependency or architectural pattern requires explicit justification and at least one alternative considered.
- Validation depth must scale with risk; do not treat successful compilation as sufficient evidence of correctness.
- For medium/high-risk changes, follow the decision process in this section and document the chosen approach before coding.

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

### Dirty Worktree And Generated Files (MUST)

- Treat all existing modified, deleted, and untracked files as user-owned unless the user explicitly says they are disposable.
- Before running tools that may write files, inspect `git status --short` and note the existing dirty state.
- After running browser, QA, codegen, or agent-helper tools, inspect `git status --short` again and identify any new side effects separately from the requested code change.
- Do not delete, revert, rewrite, or "clean up" out-of-scope files just to make the final diff look cleaner.
- If a tool creates generated artifacts such as `.gstack/`, screenshots, logs, traces, or audit files, leave them in place and report them unless the user explicitly asks to remove them.
- Never delete untracked files to restore scope. Untracked files are not recoverable from git.
- If accidental out-of-scope edits occur, stop and report the exact paths before attempting repair.

## Ask Before Making These Changes (MUST)

- Adding dependencies (`bun add ...`)
- Modifying `package.json`, `tsconfig*`, `next.config.*`
- Editing auth-critical paths (`app/auth/`, `middleware.ts`)
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

### Convex Schema Contractions

**Dormant pre-launch.** The database is disposable — change `convex/schema.ts`
directly and wipe dev data if it conflicts. See "Pre-Launch: The Database Is
Disposable". Re-activate the expand/migrate/contract workflow, manifests, and
schema-guard/preflight only when the app has real users.

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
- `.agents/troubleshooting/`
- `README.md` and `INSTALL.md`
- `docs/convex-access.md` — **read before querying Convex** (MCP/CLI/dashboard).
  The app's data lives only in the deployment `NEXT_PUBLIC_CONVEX_URL` /
  `CONVEX_DEPLOYMENT` point to; the Convex MCP can silently resolve to a
  different, empty backend. If a read returns `0 users`/`0 chats` for an app in
  active use, the tool is pointed at the wrong deployment — verify against the
  dashboard, don't trust it.

## Output Preferences (SHOULD)

- If asked to create a prompt, return it directly in chat unless a file is explicitly requested.
- Do not include timeline or effort estimates unless explicitly requested.

## Pull Request Baseline (SHOULD When Preparing PRs)

1. Run `git fetch origin` before branch comparisons.
2. Diff and log against `origin/main` (not local `main`).
3. Scope PR descriptions to commits in `origin/main..HEAD`.

## Scope Verification (MUST)

When making a narrow change, final verification must include:

1. `git diff -- <intended paths>` to confirm the intended change.
2. `git status --short` to list unrelated dirty files separately.
3. A final note distinguishing requested edits from pre-existing or tool-generated changes.

Do not stage, delete, or normalize unrelated files during this process.

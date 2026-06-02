---
name: create-plan
description: Create structured, agent-executable implementation plans with parallelized research, option analysis, and phased execution guides. Use when the user asks to create a plan, design an implementation approach, architect a feature, or prepare a step-by-step execution guide for a complex task.
---

# Create Plan

Generate implementation plans optimized for careful, strategic, bug-free AI agent execution. Plans are self-contained documents that any agent can pick up, resume at any phase, and execute without ambiguity.

## Core Principles

1. **Research before planning** — gather all context before committing to an approach
2. **Parallelize independent work** — run research, spikes, and analysis concurrently
3. **Self-contained phases** — each phase loads its own context, verifies its own output
4. **Decision gates** — pause for human input at irreversible or high-risk points
5. **Verify at every step** — `bun run typecheck`, `bun run lint` after each phase minimum
6. **Graceful degradation** — every phase includes a rollback path

## Workflow: Four Parallelized Phases

### Phase A: Research (Parallelizable)

**Goal:** Gather all context needed to make informed decisions. Do NOT plan or write code yet.

Launch these research threads in parallel:

| Thread | Focus | Method |
|--------|-------|--------|
| A1: Codebase scan | Existing patterns, related files, dependencies | Read files, grep for patterns |
| A2: External research | Best practices, library docs, API references | Web search, fetch docs |
| A3: Constraint analysis | Security, performance, permissions, edge cases | Read `AGENTS.md`, config files |
| A4: Prior art | Existing docs, related decisions | Read repo docs, relevant skills, commit history, and user-provided context |

**Parallelization rules:**
- A1–A4 are independent — run all simultaneously
- If a thread reveals new context, spawn a follow-up thread (sequential)
- Collect all thread results before proceeding to Phase B

**Output:** Research summary with key findings per thread.

### Phase B: Analyze & Evaluate Options

**Goal:** Identify approaches and evaluate trade-offs systematically.

1. **Identify options** — list 2–4 viable approaches based on research
2. **Score each option** using a comparison matrix:

| Dimension | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| Complexity | Low/Med/High | ... | ... |
| Timeline | X weeks | ... | ... |
| Risk level | Low/Med/High | ... | ... |
| Alignment with existing patterns | Strong/Weak | ... | ... |
| Evolution path | Describe | ... | ... |

3. **Recommend one option** with clear rationale
4. **Decision gate** — present options to user, wait for approval before Phase C

**Anti-patterns to avoid:**
- Skipping the comparison matrix for "obvious" choices (always show your work)

### Phase C: Draft the Plan

**Goal:** Produce a complete, agent-executable plan document.

Use the template in [template.md](template.md) as the canonical structure. Key requirements:

1. **Metadata header** — status, priority, timeline, date, decision
2. **How to Use This Plan** — instructions for agent execution
3. **Decision summary** — which option was chosen and why
4. **File map** — every file to create/modify, organized by phase
5. **Self-contained phases** with:
   - Context to load (specific file paths)
   - Numbered steps with code examples
   - Verify section (exact commands to run)
   - Decision gates where applicable
6. **Cross-cutting concerns** — security checklist, error handling patterns
7. **Architecture reference** — preserved analysis for future context

**Phase parallelization annotations:**
- Mark each phase with: `> Can run in parallel with: Phase X` or `> Dependencies: Phase X`
- Group independent phases for parallel execution
- Identify the critical path (longest sequential chain)

**Code example requirements:**
- Include TypeScript code blocks with file path comments
- Show the exact integration point, not just the new code
- Include error handling in every example
- Reference existing patterns: "Follow the pattern in `convex/userKeys.ts`"

### Phase D: Validate the Plan

**Goal:** Ensure the plan is complete, correct, and executable.

Run this validation checklist:

**Structural completeness:**
- [ ] Metadata header with all required fields
- [ ] "How to Use This Plan" section present
- [ ] Decision summary with rationale
- [ ] File map covers all phases
- [ ] Every phase has: context to load, steps, verify
- [ ] Security checklist (if applicable)
- [ ] Architecture reference preserves full analysis

**Execution safety:**
- [ ] Every phase can be resumed independently
- [ ] No phase assumes state from a previous phase without listing it in "Context to Load"
- [ ] Decision gates placed before irreversible actions
- [ ] Permission flags for operations requiring user approval (per `AGENTS.md`)
- [ ] Rollback path documented for risky phases
- [ ] Verify commands specified (not just "test it")

**Quality gates:**
- [ ] No `// @ts-ignore` or `eslint-disable` suggested anywhere
- [ ] All code examples include error handling
- [ ] File paths are absolute from project root (not relative)
- [ ] Constants defined once in a reference section, not duplicated
- [ ] Existing patterns referenced by file path, not described abstractly

**Parallelization correctness:**
- [ ] Parallel phases have no shared state or file conflicts
- [ ] Dependencies are explicitly declared
- [ ] Critical path identified

## Quick Reference: Plan Sections

| Section | Purpose | Required |
|---------|---------|----------|
| Metadata header | Status, priority, timeline, date | Yes |
| How to Use This Plan | Agent execution instructions | Yes |
| Decision Summary | What was chosen and why | Yes |
| Constants Reference | Shared values used across phases | If applicable |
| Schema Reference | Database schema changes | If applicable |
| File Map | Progress tracker for all files | Yes |
| Phase N: [Name] | Self-contained execution phases | Yes (1+) |
| Security Checklist | Cross-cutting security concerns | If applicable |
| Critical Implementation Patterns | Reusable patterns across phases | If applicable |
| Architecture Reference | Full analysis preserved for context | Recommended |

## Common Mistakes

1. **Phases that can't be resumed** — every phase must list its own context to load. An agent starting at Phase 3 should NOT need to read Phases 1–2.

2. **Missing verify steps** — "test it" is not a verify step. Specify exact commands: `bun run typecheck`, `bun run lint`, `bun run test`.

3. **Implicit dependencies** — if Phase 3 uses a type created in Phase 2, Phase 3 must declare `Dependencies: Phase 2` and list the file in "Context to Load."

4. **No decision gates before destructive actions** — modifying `convex/schema.ts`, deleting files, changing auth logic — all require explicit user approval.

5. **Abstract pattern descriptions** — don't say "follow the auth pattern." Say "follow the auth pattern in `convex/userKeys.ts`: `ctx.auth.getUserIdentity()` → resolve user via `users.by_workos_user_id` → verify ownership."

6. **Hardcoded values scattered across phases** — define constants once in a Constants Reference section; reference them by name in phases.

7. **Missing rollback paths** — for risky phases, document what to do if the phase fails: which files to revert, which migrations to undo.

8. **Over-parallelizing** — don't parallelize phases that modify the same files. If two phases edit `app/api/chat/route.ts`, they must be sequential.

## Project Conventions

- Return plans directly in chat unless the user explicitly requests a file.
- If a plan file is requested, use the user-specified path or ask for the destination before writing.
- Plans reference skills when applicable: `@.agents/skills/convex-function/SKILL.md`
- Cross-reference repo docs, code paths, official docs, and user-provided research for architectural context.

## Additional Resources

- For the full plan template, see [template.md](template.md)
- For permissions and constraints, see `@AGENTS.md`

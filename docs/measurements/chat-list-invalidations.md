# Measurement — `chats.getForCurrentUser` invalidations

- Status: Tier-1 recorded; **STOP gate** for Tier 2 (awaiting human go/no-go)
- Plan: `docs/sidebar-chat-list-streaming-plan.md` (commit 2 — measurement gate)
- Related: ADR-0004 (per-user subscription seam — the cost audit this follows up)
- Date opened: 2026-06-25
- Commit under test: `Remove redundant run-complete chats.updatedAt bump` (Tier 1, commit 1)

This is the measure-before-building gate between Tier 1 (fix the write) and
Tier 2 (bound the read). It separates three kinds of evidence:

- **Proven** — established by code inspection + the unit test in this PR.
- **Predicted** — the static read-set model (ADR-0004) applied to the Tier-1 change.
- **Pending capture** — the live Convex Functions dashboard split, which must be
  taken **against the deployed environment after commit 1 ships**. It is not
  fabricated here; the table below is a template for the operator to fill in.

---

## A. What Tier 1 changed (proven)

`chats.updatedAt` is the only field on the `chats` row that the chat-turn
lifecycle writes. Because `chats.getForCurrentUser` `.collect()`s the whole
`by_user` range, **every** write to any of the caller's chat rows invalidates the
sidebar subscription and forces a full re-collect + re-sort. So
"invalidations per turn" = "`chats.updatedAt` writes in the caller's range per turn."

Commit 1 deleted exactly one such write: the run-complete bump in
`markGenerationRunCompletedForChat` (`convex/chatRuntime.ts`, formerly line 1460).
The turn-start bump (`prepareGenerationForChat`, line 1257), the title-edit bump
(line 775), and the `messages.ts` `add` / `addBatch` / `selectBranch` bumps are
deliberately untouched.

Per-turn `chats.updatedAt` write accounting (code-derived, durable HTTP chat route):

| Lifecycle event | Mutation (site) | Writes `chats.updatedAt`? | Before | After |
| --- | --- | --- | --- | --- |
| New-message turn start | `prepareGeneration` (`chatRuntime.ts:1257`) | yes | ✓ | ✓ kept |
| User-message insert | `insertUserMessageForGeneration` (`chatRuntime.ts:474-513`) | no (message row only) | — | — |
| Assistant placeholder insert | `prepareGenerationForChat` | no (message row only) | — | — |
| Run completion | `markGenerationRunCompleted` (`chatRuntime.ts:1460`) | **was yes** | ✓ | **✗ removed** |
| **New-message / regeneration turn total** | | | **2** | **1** |
| Title-edit turn (adds the title bump) | `+ chatRuntime.ts:775` | yes | 3 | 2 |
| Branch select (separate user action) | `selectBranch` (`messages.ts:176`) | yes | 1 | 1 (unchanged) |

**Result (proven):** every durable generation turn now writes the chat row once
instead of twice. New-message and regeneration turns drop from **2 → 1**
invalidation (−50%); title-edit turns from **3 → 2** (−33%). The chat still
re-orders to the top of the sidebar at turn start, so ordering is unchanged.

Regression guard: `convex/chatRuntime.test.ts` →
"does not re-bump the chat's updatedAt when a run completes" asserts the
completion path writes **no** patch to the chat row while the run/message patches
still fire. Verified it fails if the bump is re-added.

## B. Static read-set prediction (from ADR-0004)

ADR-0004's read-set audit attributed ~225K of 927K Convex function calls to
`chats.getForCurrentUser`, and named the mechanism explicitly:

> It `.collect()`s the whole `chats.by_user` range, and the chat-turn lifecycle
> bumps `chats.updatedAt` … several times per turn. Each bump re-collects and
> re-sorts every chat.

Two independent dimensions drive that cost:

1. **Invalidation frequency** = `chats.updatedAt` writes in range per turn.
   Tier 1 reduces this by one write per durable turn (Section A).
2. **Cost per invalidation** = O(all-chats) re-collect + JS re-sort.
   **Tier 1 does not touch this.** Each surviving invalidation still re-reads the
   entire collection.

So the prediction is: Tier 1 cuts the *number* of `chats` invalidation re-runs
per turn by ~half, but leaves the *per-invalidation* read-set breadth fully
intact. For a user with a large history, the dominant term is breadth, not
frequency — which is precisely what Tier 2 (commit 8, paginated window) bounds.

## C. Live dashboard capture (pending — operator, post-deploy)

> These figures require the deployed environment + the Convex Functions
> dashboard + representative traffic. They cannot be captured from the local
> repo and are **not** filled in here. Capture after commit 1 deploys.

Procedure:
1. Deploy commit 1 to the target deployment.
2. In the Convex dashboard → Functions, over a fixed window, record the call
   counts below. Drive a known number of durable turns (send N messages) so the
   per-turn figure is derivable.

| Field | Value | Notes |
| --- | --- | --- |
| Capture date | _pending_ | |
| Sample: messages sent (N) | _pending_ | durable turns only |
| Sample: window duration | _pending_ | |
| `chats.getForCurrentUser` — initial-subscribe calls | _pending_ | one per mount/auth-ready |
| `chats.getForCurrentUser` — invalidation re-runs | _pending_ | the figure Tier 1 targets |
| Invalidation re-runs **per turn** | _pending_ | expect ≈ 1 (Section A) |
| Control: `users.getCurrent` calls | _pending_ | ADR-0004 baseline ≈ 3.7K |
| `userKeys.getProviderStatus` — guest-caller count | _pending_ | expect **0** post ADR-0004 |

Sanity checks:
- Per-turn invalidation should land at ≈ 1 (Section A). A figure near 2 means a
  bump path was missed or re-added.
- `userKeys.getProviderStatus` guest-caller count should be 0 (ADR-0004 gated it
  on `isConvexAuthenticated` and removed the duplicate subscription). A non-zero
  count is an ADR-0004 regression, not a Tier-1 issue, but worth catching here.

## D. Go / No-Go for Tier 2

**Recommendation: GO (proceed to Tier 2), conditional on the Section C capture
confirming the residual is material.**

Reasoning:
- Tier 1 is necessary but **not sufficient**. It halves invalidation frequency
  but leaves the O(all-chats) per-invalidation read-set — the mechanism ADR-0004
  identified as the dominant cost — completely unchanged. The win that ADR-0004's
  audit actually pointed at (read-set breadth) is delivered only by Tier 2's
  bounded window (commit 8), which the prerequisite commits 3–7 make safe.
- Structurally, for any user with a non-trivial history, the surviving
  invalidations still each re-read the whole collection, so `chats.getForCurrentUser`
  will remain well above the cheap control (`users.getCurrent`) even after Tier 1.
  That is the "residual cost is material" condition in the plan's gate.

Decision rule for the human, once Section C is filled in:
- **GO** if post-Tier-1 `chats.getForCurrentUser` invalidation re-runs remain a
  large multiple of the control (`users.getCurrent`), i.e. the read-set breadth
  still dominates — the expected case.
- **DEFER** (stop the PR at commits 1–2 as a complete, shippable unit) if Tier 1
  alone brought `chats` down to within a small multiple of the control, such that
  bounding the read would not move the needle enough to justify the Tier-2 risk
  (the high-risk sidebar swap in commit 8).

Tier 2 must not begin until a human reviews the Section C capture and approves.

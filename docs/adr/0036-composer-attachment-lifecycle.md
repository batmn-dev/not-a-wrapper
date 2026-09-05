# ADR-0036: Composer attachments own admission and dispatch lifetime

- Status: accepted
- Date: 2026-09-04
- Related: ADR-0012, ADR-0023, ADR-0024, ADR-0033

## Context

The attachment module owned upload attempts, retry, and removal, but Composer
coordinated readiness, payload assembly, locking, unlocking, and consumption.
Tests reproduced that protocol through mocks instead of exercising its outcome.
File selection also checked duplicates before asynchronous admission and added
files afterward. During admission, Send and another selection could not see them.

## Decision

- Selected files appear and reserve their identities synchronously. The existing
  indeterminate uploading presentation covers both admission and transfer; no new
  controls, labels, or animated loading treatment are introduced.
- Pending files block Send immediately. Invalid or over-capacity selections are
  removed with the existing error feedback. The server remains authoritative for
  upload allowance; the client considers earlier pending selections in its check.
- Admission batches settle in selection order so invalid reservations are released
  before the next capacity check. Transfers run concurrently after admission.
- Admission completion must still belong to a selected file. Removal and unmount
  invalidate it, preventing a late validation result from starting an upload.
- The existing Composer attachment module owns readiness, payload assembly, and
  the submitted snapshot through `submitAttachments(text, dispatch)`. Its caller
  no longer coordinates lock/unlock/consume operations.
- An accepted dispatch consumes exactly its submitted files without deleting
  bound storage rows. Rejection or exceptions release locks and preserve files.
  Files selected during dispatch remain available for the next Chat turn.
- Composer clears or restores a submitted draft only while its edit revision
  remains current. A later edit retains its pending or completed persistence
  write, even when the previous send settles. Revisions stay keyed by persistence
  identity across revisits. Rejected text is restored only while its original
  display identity is active, so navigating cannot restore it into another chat.
- Composer retains draft ownership. Chat turn execution, atomic first-turn
  creation, and durable attachment binding retain their existing owners.

## Alternatives considered

- **Recheck duplicates after validation only.** Fixes duplicate enqueueing, but
  leaves selected files invisible to Send while admission is pending.
- **Add a separate visible upload queue.** Vercel Chatbot's local reference
  (`c2f8235`, `components/chat/multimodal-input.tsx`) shows immediate pending
  filenames and disables Send. Here the existing attachment identity can span
  admission and transfer, so a second presentation collection adds no leverage.
- **Leave handoff orchestration in Composer.** Retains ordering knowledge in two
  modules and forces tests to reproduce the protocol.

## Verification

Focused tests exercise pending admission, duplicate reservation, overlapping
capacity checks, cancellation during validation, and accepted/rejected/throwing
dispatch with a later selection. A Composer test retains the real attachment
module and delays validation to prove Send is blocked without clearing the draft.

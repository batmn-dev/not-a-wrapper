---
name: ui-component-match
description: Systematically match a UI component implementation to a reference design by comparing rendered HTML, structure, measurements, spacing, and styling before making UI changes. Use when implementing or debugging UI that must match an existing reference implementation.
---

# UI Component Match Skill

**Purpose:** Systematically match a UI component implementation to a reference design (e.g., ChatGPT, Linear, Figma) by comparing rendered HTML, extracting measurements, and identifying all differences before making changes.

**Use when:** Implementing or debugging a UI component that needs to match an existing reference implementation.

---

## Skill Phases

### Phase 0: HTML Extraction & Comparison

**Before touching any code**, extract and compare the actual rendered HTML.

#### Step 0.1: Extract Reference HTML
- If browser accessible: Use DevTools to copy outerHTML of the reference component
- If reference files exist: Use `@.agents/design/[reference-name]/` files
- Save to `reference-output.html` for diffing

#### Step 0.2: Extract Our HTML
- Run local dev server
- Use browser DevTools to copy outerHTML of our component
- Save to `our-output.html` for diffing

#### Step 0.3: Side-by-Side Class Comparison
Create a comparison table of EVERY element:

```markdown
| Element | Reference Classes | Our Classes | Match? |
|---------|------------------|-------------|--------|
| Root container | `p-2.5 grid ...` | `p-0 grid ...` | ❌ p-0 overrides p-2.5 |
| Primary wrapper | `-my-2.5 flex ...` | `-my-2.5 flex ...` | ✅ |
| Inner wrapper | `flex-1 overflow-auto` | MISSING | ❌ |
```

**Output:** A complete list of differences with priority (structural > spacing > styling)

---

### Phase 1: Measurement Extraction

Extract ALL spacing/sizing values from reference files or browser.

#### Step 1.1: Read Reference Documentation
- Check `.agents/design/[reference]/` for existing measurements
- Extract values from CSS reference files
- Note: Always prefer documented values over live inspection

#### Step 1.2: Create Measurement Table

```markdown
## Spacing Measurements

| Property | Reference Value | Our Value | Status |
|----------|----------------|-----------|--------|
| Container padding | 10px (p-2.5) | 0px (p-0 override!) | ❌ |
| Container max-width | 768px | 768px | ✅ |
| Horizontal padding (base) | 16px | 16px | ✅ |
| Horizontal padding (@1024px) | 64px | 32px | ❌ |
| Primary wrapper margin | -10px top/bottom | -10px top/bottom | ✅ |
| Primary wrapper padding | 6px horizontal | 6px horizontal | ✅ |
| Textarea padding | 0 0 16px | 0 0 16px | ✅ |
| Textarea line-height | 24px | 24px | ✅ |
```

#### Step 1.3: Box Model Calculation
Calculate expected rendered dimensions:

```
Reference:
  Container: 768px width + 128px padding (@1024px) = content + padding in separate containers

Ours (WRONG):
  Container: 768px max-width INCLUDING padding = 640px actual content (@1024px)
```

**Output:** Complete measurement table + box model diagram

---

### Phase 2: Gap Analysis

Systematically categorize all differences.

#### Step 2.1: Categorize Issues

**Structural Issues (fix first):**
- Missing elements (inner wrappers, containers)
- Wrong element hierarchy
- Missing/incorrect grid areas

**Spacing Issues (fix second):**
- Padding overrides (p-0 vs p-2.5)
- Margin discrepancies
- Width/height mismatches

**Styling Issues (fix last):**
- Border radius, shadows, colors
- Typography (font-size, line-height, letter-spacing)

#### Step 2.2: Identify Override Conflicts

Check for CSS specificity/order issues:
- Props overriding component internals (className="p-0" overriding internal p-2.5)
- Tailwind class order conflicts (later classes override earlier)
- Important flags or inline styles

**Output:** Prioritized issue list with root cause identified

---

### Phase 3: Systematic Fix Implementation

Fix ALL issues in one coherent change, not incrementally.

#### Step 3.1: Create Fix Plan

```markdown
## Fix Plan

1. Remove `p-0` override from chat-input.tsx:232 (blocks internal p-2.5)
2. Add missing inner wrapper to PromptInputPrimary with flex-1 overflow-auto
3. Update horizontal padding: @[1024px]/main:px-8 → px-16 (32px → 64px)
4. Remove incorrect `self-end` from Leading/Trailing slots
5. Add `flex items-center gap-2` to Trailing slot
6. Remove `items-end` from grid container
```

#### Step 3.2: Implement All Fixes
- Make all changes in a single session
- Don't test incrementally (prevents half-broken states)
- Verify lint/typecheck after all changes

---

### Phase 4: Verification

Systematically verify the implementation matches.

#### Step 4.1: HTML Re-extraction
- Extract our new HTML output
- Compare with reference HTML
- Verify ALL classes now match

#### Step 4.2: Visual Verification
- Take screenshots at multiple breakpoints (mobile, tablet, desktop)
- Measure actual rendered dimensions with browser DevTools
- Compare side-by-side with reference screenshots

#### Step 4.3: Measurement Verification
- Re-check measurement table
- Verify all spacing values match
- Confirm box model calculations are correct

**Output:** ✅ Component matches reference OR → back to Phase 2 with new gap list

---

## Skill Rules

### NEVER Skip Phase 0
The HTML comparison is the source of truth. Don't make changes without it.

### Fix Structurally, Not Incrementally
Don't fix one issue, test, fix another, test. Identify all issues first, then fix together.

### Verify Against Source, Not Assumptions
Always compare with reference files or rendered output, never rely on memory or assumptions.

### Document Override Conflicts
If a prop overrides component internals (p-0 overriding p-2.5), document it explicitly.

### Use Measurement Tables
Create explicit tables for every spacing value. Don't rely on "looks about right."

---

## Anti-Patterns (What NOT to Do)

❌ **Don't start with live browser inspection of the reference**
- Use documented reference files first
- Only use live inspection if no docs exist

❌ **Don't make incremental fixes**
- "Fix padding" → test → "fix margin" → test
- This creates churn and half-broken states

❌ **Don't assume components work correctly**
- Always verify props aren't overriding internals
- Check for CSS specificity conflicts

❌ **Don't skip visual verification**
- Code might look right but render wrong
- Always take screenshots and measure

❌ **Don't trust "it works on my machine"**
- Check at multiple viewport sizes
- Verify on actual target breakpoints

---

## Success Criteria

✅ **HTML classes match** (verified by side-by-side diff)
✅ **All measurements match** (verified by measurement table)
✅ **Box model correct** (verified by DevTools inspection)
✅ **Visual match** (verified by screenshot comparison)
✅ **No override conflicts** (verified by checking className props)

---

## Example Usage

```markdown
User: "Make our composer match ChatGPT's layout"

Agent:
1. [Phase 0] Extract HTML from ChatGPT reference files and our app
2. [Phase 0] Create side-by-side class comparison → find p-0 override, missing wrapper, etc.
3. [Phase 1] Extract measurements from reference → create table
4. [Phase 2] Categorize issues → structural (missing wrapper), override (p-0), spacing (px-8 vs px-16)
5. [Phase 3] Fix all 6 issues in one change
6. [Phase 4] Verify HTML matches, take screenshots, measure dimensions

Result: Component matches in single iteration, not 5+ failed attempts
```

---

## Skill Metadata

**Category:** UI Implementation
**Difficulty:** Intermediate
**Time to execute:** 30-60 minutes (vs hours of trial-and-error)
**Prerequisites:** Reference design files or access to reference implementation
**Tools:** Browser DevTools, reference files, measurement tools
**Success rate:** ~95% (vs ~20% with ad-hoc approach)

---

## Related Skills

- `design-token-extraction` — Extract design tokens from live pages
- `html-structure-extraction` — Extract full HTML structure into markdown
- `component-state-extraction` — Extract interactive component states

---

*This skill was created in response to a failed composer layout migration where 5 attempts were needed because HTML comparison was done last instead of first.*

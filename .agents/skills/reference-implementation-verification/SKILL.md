---
name: reference-implementation-verification
description: Verify reference-based UI implementations against extracted measurements and checklists. Use after implementing UI from competitor apps, design mockups, or captured reference data before marking the work complete.
---

# Reference Implementation Verification

**Use this skill when:** Implementing UI features based on reference designs (ChatGPT, competitor apps, design mockups, etc.)

**Purpose:** Ensure implementation matches extracted reference data through systematic measurement verification

**Why it exists:** Prevents misinterpretation gaps between analysis ("I understand the structure") and implementation ("I built it correctly")

---

## When to Use

- After completing Phase 1 (extraction) and Phase 2 (implementation) of any reference-based UI work
- When implementing layouts with specific positioning, flex layouts, or precise measurements
- Before marking implementation tasks as complete

---

## The Skill Process

### Phase 1: Create Verification Checklist from Analysis

**After extracting reference data, create a measurement checklist:**

```markdown
# Verification Checklist: [Feature Name]

## Critical Measurements

| Element | Property | Reference Value | Tolerance | Implementation Value | Status |
|---------|----------|-----------------|-----------|---------------------|--------|
| Model selector | left position | 268px | ±10px | [ TBD ] | [ ] |
| Header | height | 52px | exact | [ TBD ] | [ ] |
| Left section | flex-grow | 0 | exact | [ TBD ] | [ ] |
| Center section | flex-grow | 1 | exact | [ TBD ] | [ ] |
| Right section | flex-grow | 0 | exact | [ TBD ] | [ ] |
| Left section | width | 0px | ±5px | [ TBD ] | [ ] |
| Input area | bottom | ≤ viewport height | exact | [ TBD ] | [ ] |

## Flex Layout Verification

For any flex container:
- [ ] Extract flex-grow for each child
- [ ] Extract flex-shrink for each child
- [ ] Extract flex-basis for each child
- [ ] Verify implementation uses same values
- [ ] Measure resulting widths/positions match reference

## Positioning Verification

For positioned elements:
- [ ] Extract position type (static/relative/absolute/fixed/sticky)
- [ ] Extract top/right/bottom/left values
- [ ] Extract z-index
- [ ] Verify implementation matches exactly
- [ ] Measure final coordinates match reference ±tolerance
```

### Phase 2: Implementation with Inline Verification

**While implementing, verify each critical value:**

```tsx
// ❌ BAD: Implementing without verification
<div className="flex flex-1 items-center">
  {/* No verification that flex-1 matches reference */}
</div>

// ✅ GOOD: Implementing with inline verification notes
<div className="flex items-center"> {/* flex-grow: 0 per reference section[0] */}
  {/* Reference: width 0px, flex-grow 0 */}
</div>

<div className="flex flex-1 items-center"> {/* flex-grow: 1 per reference section[1] */}
  {/* Reference: width 1027px, flex-grow 1 */}
  <ModelSelector /> {/* Should appear at left ~268px */}
</div>
```

### Phase 3: Post-Implementation Measurement

**After implementing, measure actual values:**

```javascript
// Verification script (run in browser console or via automation)
const modelSelector = document.querySelector('[data-testid="model-selector"]');
const sections = document.querySelectorAll('header > div > div');

console.log('Verification Results:');
console.log('Model selector left:', modelSelector.getBoundingClientRect().left);
console.log('Expected: 268px ±10px');

sections.forEach((section, i) => {
  const styles = window.getComputedStyle(section);
  console.log(`Section ${i}:`, {
    flexGrow: styles.flexGrow,
    width: section.getBoundingClientRect().width
  });
});
```

**Fill in verification checklist:**
```markdown
| Model selector | left position | 268px | ±10px | **264px** ✅ | PASS |
| Left section | flex-grow | 0 | exact | **0** ✅ | PASS |
| Center section | flex-grow | 1 | exact | **1** ✅ | PASS |
```

### Phase 4: Visual Comparison (Side-by-Side)

**Take comparison screenshots:**

1. **Reference screenshot** (from ChatGPT/competitor)
2. **Implementation screenshot** (from your app)
3. **Overlay/side-by-side comparison**

**Mark up with measurement annotations:**
- Draw vertical lines at key positions (e.g., model selector left edge)
- Label with pixel coordinates
- Verify coordinates match within tolerance

**Tools:**
- Browser DevTools (measure tool)
- Screenshot annotation tools
- Overlay with reduced opacity in image editor

### Phase 5: Edge Case Testing

**Test at extremes where misalignment is most visible:**

```markdown
## Edge Case Testing Checklist

- [ ] Smallest supported viewport (400px width, 600px height)
- [ ] Largest supported viewport (1920px+)
- [ ] Mobile landscape orientation
- [ ] With sidebar open/closed (if applicable)
- [ ] With maximum content (longest text, most buttons)
- [ ] With minimum content (empty states)
- [ ] Light and dark themes
```

---

## Example: Header Flex Layout Verification

### Reference Data (Extracted from ChatGPT)

```markdown
| Section | flex-grow | flex-basis | width (computed) |
|---------|-----------|------------|------------------|
| Left    | 0         | auto       | 0px              |
| Center  | 1         | 0%         | 1027.78px        |
| Right   | 0         | auto       | 136.22px         |
```

### Implementation Code

```tsx
// ✅ CORRECT: Matches reference flex values
<div className="flex items-center">          {/* flex-grow: 0 ✓ */}
  {/* Left content */}
</div>

<div className="flex flex-1 items-center">   {/* flex-grow: 1 ✓ */}
  <ModelSelector />
</div>

<div className="flex items-center">          {/* flex-grow: 0 ✓ */}
  {/* Right actions */}
</div>

// ❌ WRONG: All sections have flex-1 (equal distribution)
<div className="flex flex-1 items-center">   {/* flex-grow: 1 ✗ Should be 0 */}
<div className="flex flex-1 items-center">   {/* flex-grow: 1 ✓ */}
<div className="flex flex-1 items-center">   {/* flex-grow: 1 ✗ Should be 0 */}
```

### Verification Measurements

```javascript
// Run in browser after implementation
const sections = document.querySelectorAll('header > div > div');
const results = Array.from(sections).map((s, i) => ({
  index: i,
  flexGrow: window.getComputedStyle(s).flexGrow,
  width: s.getBoundingClientRect().width
}));

console.table(results);

// Expected output:
// index | flexGrow | width
// 0     | "0"      | 0
// 1     | "1"      | ~1027
// 2     | "0"      | ~136

// ✅ PASS if matches
// ❌ FAIL if flexGrow all "1" and widths equal thirds
```

---

## Checklist for Claude Agents

When implementing reference-based UI:

1. **Before implementation:**
   - [ ] Create verification checklist from extracted data
   - [ ] Identify critical measurements (positions, sizes, flex values)
   - [ ] Set tolerance ranges (exact, ±5px, ±10px)

2. **During implementation:**
   - [ ] Add inline comments referencing source data
   - [ ] Verify each critical value as you write it
   - [ ] Mark uncertain implementations for review

3. **After implementation:**
   - [ ] Run measurement verification script
   - [ ] Fill in actual values in checklist
   - [ ] Take comparison screenshots
   - [ ] Test edge cases

4. **Before marking complete:**
   - [ ] All measurements within tolerance
   - [ ] Visual comparison shows alignment
   - [ ] Edge cases tested
   - [ ] Document any intentional deviations

---

## Common Pitfalls This Prevents

1. **"Three-column layout" misinterpretation**
   - Prevents: Assuming "three columns" means "equal thirds"
   - Verification catches: flex-grow values don't match, resulting widths wrong

2. **"Centered content" ambiguity**
   - Prevents: Confusing "in center column" with "centered within header"
   - Verification catches: left position 653px vs expected 268px

3. **"Looks about right" approval**
   - Prevents: Eyeballing instead of measuring
   - Verification catches: 385px difference in position

4. **Reference data → implementation disconnect**
   - Prevents: Having correct data but using wrong values
   - Verification catches: Any mismatch between reference and actual

---

## Integration with Development Workflow

Add to implementation plans:

```markdown
## Phase X: Implementation

**Tasks:**
1. Implement feature based on reference analysis
2. **Run Reference Implementation Verification** ← ADD THIS
3. Fix any discrepancies found
4. Git commit

**Acceptance Criteria:**
- Functionality works
- **All measurements in verification checklist pass** ← ADD THIS
- Tests pass
```

---

## Skill Output

This skill produces:

1. **Verification checklist** (markdown table with measurements)
2. **Measurement script** (JavaScript for browser console)
3. **Pass/fail status** for each critical measurement
4. **Comparison screenshots** (annotated with positions)
5. **Deviation report** (if any measurements outside tolerance)

---

## Example Verification Report

```markdown
# Verification Report: Sticky Header Implementation

**Date:** 2026-02-20
**Reference:** ChatGPT (chatgpt.com)
**Implementation:** Not A Wrapper

## Measurement Results

| Element | Property | Reference | Tolerance | Actual | Status | Deviation |
|---------|----------|-----------|-----------|--------|--------|-----------|
| Model selector | left | 268px | ±10px | 264px | ✅ PASS | -4px |
| Header | height | 52px | exact | 52px | ✅ PASS | 0px |
| Left section | flex-grow | 0 | exact | 0 | ✅ PASS | 0 |
| Center section | flex-grow | 1 | exact | 1 | ✅ PASS | 0 |
| Right section | flex-grow | 0 | exact | 0 | ✅ PASS | 0 |
| Input area | bottom | ≤761px | exact | 732px | ✅ PASS | -29px |

## Summary

- **Total checks:** 6
- **Passed:** 6 (100%)
- **Failed:** 0
- **Warnings:** 0

## Visual Comparison

[Screenshot: Side-by-side comparison]
- Model selector position: Aligned ✅
- Header height: Matched ✅
- Spacing: Consistent ✅

## Approval

✅ Implementation matches reference within acceptable tolerances.
Ready for integration testing.
```

---

**Skill Maintenance:** Update this skill when new verification techniques are discovered or when measurement tools evolve.

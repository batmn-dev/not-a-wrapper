---
name: layout-math-verification
description: Audit viewport units, full-height layouts, and positioning changes to prevent overflow, cropped inputs, and layout calculation bugs. Use when changing app shells, sticky headers, scroll containers, or vh/dvh/svh-based layouts.
---

# Layout Math Verification

**Use this skill when:** Making changes to layouts that use viewport units (vh, dvh, svh, vw) or changing element positioning schemes

**Purpose:** Prevent viewport overflow, input cropping, and layout calculation errors through systematic height/width audits

**Why it exists:** Prevents the "header in flow + content using 100% parent = overflow" class of bugs

---

## When to Use

### Required for these scenarios:

1. **Changing positioning schemes:**
   - `position: fixed` → `position: sticky` (out of flow → in flow)
   - `position: absolute` → `position: relative` (out of flow → in flow)
   - Any change that moves an element from outside document flow to inside

2. **Using viewport units:**
   - Any container with `h-vh`, `h-dvh`, `h-svh`, `min-h-screen`
   - Any container with `w-vw`, `max-w-screen`
   - Nested containers both using viewport units

3. **Full-height layouts:**
   - Chat interfaces, dashboards, app shells
   - Layouts with sticky headers/footers
   - Scrollable content areas

4. **Before committing:**
   - Any PR that touches layout containers
   - Any change to header/footer positioning
   - Any change to main content area dimensions

---

## The Verification Process

### Step 1: Enumerate Space-Consuming Children

**For each container using viewport units, list ALL children:**

```markdown
## Layout Math Audit: <main> element

**Container:** `<main className="h-svh overflow-y-auto">`
**Container height:** 100svh (761px at current viewport)

### Children (in document flow):

| Child | Position | Height | In Flow? | Consumes Space? |
|-------|----------|--------|----------|-----------------|
| Header | sticky | 52px | ✅ Yes | ✅ Yes (52px) |
| Chat content | static | h-full | ✅ Yes | ✅ Yes (100% = ???) |

### Math Check:

```
Container height: 100svh (761px)
Header (in-flow): 52px
Content (h-full = 100% of parent): 100svh (761px)

Total: 52px + 761px = 813px
Container: 761px

OVERFLOW: 813px - 761px = 52px ❌ FAIL
```

**Diagnosis:** Content using `h-full` doesn't account for header consuming 52px.

**Fix:** Content should use `flex-1` in a flex container, or `calc(100svh - 52px)`.
```

### Step 2: Calculate Expected vs Actual

**Use this formula for each child:**

```javascript
// For percentage-based heights
child_height_resolved = (parent_height * child_percentage / 100)

// Example:
// Parent: 100svh = 761px
// Child: h-full = 100%
// Resolved: 761px * 100 / 100 = 761px

// For flex-1 in flex container
child_height_resolved = (parent_height - sibling_fixed_heights) / total_flex_grow

// Example:
// Parent: 761px (100svh), flex-direction: column
// Sibling 1: 52px (flex: none)
// Sibling 2: flex: 1
// Resolved: (761px - 52px) / 1 = 709px ✅ CORRECT
```

### Step 3: Verify Sum ≤ Container

```markdown
## Verification Formula

Sum of all in-flow child heights ≤ Container height

✅ PASS: Sum < Container (children fit with room to spare)
✅ PASS: Sum = Container (children exactly fill container)
❌ FAIL: Sum > Container (OVERFLOW - content cropped/scrolls)

## Example (Before Fix):

Container: 761px
Children sum: 52px + 761px = 813px
Result: 813px > 761px ❌ OVERFLOW

## Example (After Fix):

Container: 761px (flex column)
Children sum: 52px (fixed) + 709px (flex-1) = 761px
Result: 761px = 761px ✅ PERFECT FIT
```

### Step 4: Test at Minimum Viewport

**Why:** Overflow bugs manifest most obviously at smallest viewport height.

**Test at these heights:**
- 600px (small laptop)
- 500px (tablet landscape)
- 400px (mobile landscape)
- 375px (iPhone SE portrait)

```markdown
## Minimum Viewport Test

**Test at:** 375px height (iPhone SE)

Container: 100svh = 375px
Header: 52px (in-flow, sticky)
Content: h-full = 100% = 375px

Sum: 52px + 375px = 427px
Overflow: 427px - 375px = **52px cropped** ❌

**User impact:** Input area cropped 52px below viewport fold.
```

---

## Positioning Scheme Change Checklist

When changing from `position: fixed` to `position: sticky` (or any out-of-flow to in-flow):

```markdown
### Pre-Change Audit

**Current state:**
- Element position: fixed (out of flow)
- Parent container height: [value]
- Children using % of parent: [list]
- Expected behavior: Element doesn't consume parent space

### Change Impact Analysis

**After change:**
- Element position: sticky (in flow)
- Element height: [value] ← NOW CONSUMES PARENT SPACE
- Parent container height: [unchanged]
- Children using % of parent: [same children] ← PROBLEM!

### Required Adjustments

**Option 1: Adjust children**
- Change child from `h-full` to `flex-1` (in flex container)
- Use `calc()`: `calc(100% - 52px)` (fragile, avoid if possible)

**Option 2: Restructure container**
- Wrap children in inner div
- Inner div gets remaining space (flex-1)
- Children use h-full of inner div (now correct)

**Option 3: Add wrapper scroll container**
- Parent becomes flex column
- Fixed-height header
- Scroll wrapper with flex-1
- Content inside scroll wrapper uses h-full
```

---

## Common Patterns & Fixes

### Pattern 1: Sticky Header + Full-Height Content

**Problem:**
```tsx
<main className="h-svh overflow-y-auto">
  <Header className="sticky top-0 h-12" />    {/* 52px in-flow */}
  <Content className="h-full" />              {/* 100% = 100svh */}
</main>
// Result: 52px + 100svh = OVERFLOW
```

**Fix Option A: Flex Layout (Recommended)**
```tsx
<main className="flex h-svh flex-col overflow-hidden">
  <Header className="sticky top-0 h-12 shrink-0" />  {/* 52px */}
  <div className="flex-1 min-h-0 overflow-hidden">   {/* svh - 52px */}
    <Content className="h-full" />                    {/* Now correct */}
  </div>
</main>
```

**Fix Option B: Calc (Not Recommended - Brittle)**
```tsx
<main className="h-svh overflow-y-auto">
  <Header className="sticky top-0 h-12" />
  <Content className="h-[calc(100svh-3rem)]" />  {/* Fragile if header height changes */}
</main>
```

### Pattern 2: Nested Viewport Units

**Problem:**
```tsx
<div className="h-screen">              {/* 100vh */}
  <div className="h-screen">            {/* 100vh of parent = 100vh */}
    <Content />
  </div>
</div>
// Result: No overflow, but inner div is taller than outer
```

**Fix:**
```tsx
<div className="h-screen">              {/* 100vh */}
  <div className="h-full">              {/* 100% of parent = 100vh */}
    <Content />
  </div>
</div>
```

### Pattern 3: Mobile Viewport (dvh vs svh)

**Problem with dvh:**
```tsx
<main className="h-dvh">                {/* Changes when address bar shows/hides */}
  <Header className="sticky h-12" />
  <Content />
</main>
// Result: Layout shift when scrolling (address bar appears/disappears)
```

**Fix with svh:**
```tsx
<main className="h-svh">                {/* Static, ignores address bar */}
  <Header className="sticky h-12" />
  <Content />
</main>
// Result: Stable height, no layout shift
```

---

## Verification Script Template

**Run this in browser console after layout changes:**

```javascript
/**
 * Layout Math Verification Script
 * Checks if container height >= sum of children heights
 */
function verifyLayoutMath(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    console.error('Container not found:', containerSelector);
    return;
  }

  const containerHeight = container.getBoundingClientRect().height;
  const containerStyles = window.getComputedStyle(container);
  const children = Array.from(container.children);

  console.log(`\n=== Layout Math Verification: ${containerSelector} ===`);
  console.log(`Container height: ${containerHeight}px`);
  console.log(`Overflow: ${containerStyles.overflow}`);
  console.log(`\nChildren:`);

  let totalHeight = 0;
  children.forEach((child, i) => {
    const styles = window.getComputedStyle(child);
    const rect = child.getBoundingClientRect();
    const inFlow = styles.position !== 'absolute' && styles.position !== 'fixed';

    if (inFlow) {
      totalHeight += rect.height;
    }

    console.log(`  ${i}: ${child.tagName}.${child.className.split(' ')[0]}`);
    console.log(`     Height: ${rect.height}px`);
    console.log(`     Position: ${styles.position}`);
    console.log(`     In flow: ${inFlow}`);
    console.log(`     Flex: ${styles.flex}`);
  });

  console.log(`\nTotal in-flow children height: ${totalHeight}px`);
  console.log(`Container height: ${containerHeight}px`);

  const overflow = totalHeight - containerHeight;
  if (overflow > 0) {
    console.error(`❌ OVERFLOW: ${overflow}px`);
    console.error(`Content is cropped below viewport!`);
  } else if (overflow === 0) {
    console.log(`✅ PERFECT FIT: ${overflow}px`);
  } else {
    console.log(`✅ FITS WITH ROOM: ${Math.abs(overflow)}px remaining`);
  }

  return {
    containerHeight,
    totalChildrenHeight: totalHeight,
    overflow,
    status: overflow > 0 ? 'FAIL' : 'PASS'
  };
}

// Usage:
verifyLayoutMath('main');  // Check main container
verifyLayoutMath('.chat-container');  // Check specific container
```

**Example output:**
```
=== Layout Math Verification: main ===
Container height: 761px
Overflow: auto

Children:
  0: HEADER.sticky
     Height: 52px
     Position: sticky
     In flow: true
     Flex: 0 0 auto
  1: DIV.flex-1
     Height: 709px
     Position: static
     In flow: true
     Flex: 1 1 0%

Total in-flow children height: 761px
Container height: 761px

✅ PERFECT FIT: 0px
```

---

## Checklist for Claude Agents

Before committing layout changes:

1. **Identify affected containers:**
   - [ ] List all containers using `h-vh`, `h-dvh`, `h-svh`
   - [ ] List all containers with `overflow-y-auto` or `overflow-hidden`

2. **For each container, audit children:**
   - [ ] Enumerate all in-flow children (exclude fixed/absolute)
   - [ ] Note each child's height (fixed px, %, flex)
   - [ ] Calculate total height

3. **Verify math:**
   - [ ] Sum of children ≤ container height
   - [ ] No overflow unless intentional (scrolling)
   - [ ] Input areas fully visible in viewport

4. **Test at minimums:**
   - [ ] Test at 600px height
   - [ ] Test at 375px height (mobile)
   - [ ] Verify no content cropped

5. **Run verification script:**
   - [ ] Copy script to console
   - [ ] Run `verifyLayoutMath('main')`
   - [ ] All checks pass

---

## Example: Sticky Header Migration Audit

### Before Change

```markdown
## Current State (Fixed Header)

**Container:** `<main className="h-dvh overflow-y-auto">`
**Header:** `<header className="fixed top-0 h-14">` (OUT of flow)

### Math:
- Container: 100dvh = 761px
- Header: 56px (FIXED - doesn't consume parent space)
- Content: h-full = 100% = 761px

Total in-flow: 761px
Container: 761px
Status: ✅ PASS (header out of flow)
```

### After Change (Without Fix)

```markdown
## Proposed State (Sticky Header)

**Container:** `<main className="h-svh overflow-y-auto">`
**Header:** `<header className="sticky top-0 h-12">` (IN flow)

### Math:
- Container: 100svh = 761px
- Header: 52px (STICKY - CONSUMES parent space)
- Content: h-full = 100% = 761px

Total in-flow: 52px + 761px = 813px
Container: 761px
Status: ❌ FAIL (52px overflow)

**Impact:** Input area cropped 52px below viewport
```

### Required Fix

```markdown
## Fixed State (With Wrapper)

**Container:** `<main className="flex h-svh flex-col overflow-hidden">`
**Header:** `<header className="sticky top-0 h-12 shrink-0">`
**Wrapper:** `<div className="flex-1 min-h-0 overflow-hidden">`
**Content:** Inside wrapper, uses `h-full`

### Math:
- Container: 100svh = 761px (flex column)
- Header: 52px (flex: none)
- Wrapper: flex-1 = (761px - 52px) / 1 = 709px
- Content: h-full of wrapper = 709px

Total in-flow: 52px + 709px = 761px
Container: 761px
Status: ✅ PASS (perfect fit)
```

---

## Integration with Development Workflow

Add to implementation plans:

```markdown
## Phase X: Change Positioning Scheme

**Tasks:**
1. Change header from fixed to sticky
2. **Run Layout Math Verification** ← ADD THIS
3. Fix any overflow issues found
4. Test at minimum viewport (375px height)
5. Git commit

**Acceptance Criteria:**
- Header sticks correctly
- **Layout math verification passes** ← ADD THIS
- **No content cropped at 375px height** ← ADD THIS
- Tests pass
```

---

## Skill Output

This skill produces:

1. **Layout math audit table** (container + children heights)
2. **Verification script results** (console output)
3. **Pass/fail status** (overflow detected or not)
4. **Fix recommendations** (if overflow found)
5. **Test results** at minimum viewport

---

**Skill Maintenance:** Update when new viewport units are introduced (e.g., `lvh`, `svh`) or new positioning values (e.g., `position: sticky-top`).

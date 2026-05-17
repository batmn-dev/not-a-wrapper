# Front-End Technical Review: Rendering Finance UI and Widgets for Enabled Finance Features

## Executive summary

Finance-related UI for enabled Finance features is built around a separation between:

```text
financial data retrieval
→ widget-specific data-resource generation
→ widget rendering
→ conversational explanation around the widget
```

The assistant does not manually construct every chart or table from raw transaction rows. Instead, Finance widgets are rendered from structured data resources produced by Finance-specific widget queries.

A representative example is the spend-by-category widget:

For a front-end engineer, the most important concept is this:

```text
The widget renderer does not receive raw query instructions.
It receives a resolved data-resource reference.
```

The data-resource URI acts as the contract boundary between the Finance data layer and the UI component layer.

---

# 1. Mental model

Finance UI is not just markdown plus tables. It is a hybrid rendering system with three output modes:

```text
1. Plain conversational text
2. Structured markdown summaries
3. Interactive Finance widgets
```

The assistant can answer a finance question using one or more of these modes.

For example:

```text
User: What did I spend this month?
```

A good response might include:

```text
- A short natural-language summary
- A spend-by-category widget
- A few interpreted takeaways
```

The UI system therefore needs to support both:

```text
assistant-authored explanation
```

and:

```text
embedded Finance widget components
```

within the same conversational turn.

---

# 2. High-level render architecture

A simplified front-end architecture looks like this:

```text
┌──────────────────────────────────────────────┐
│ Chat Message                                  │
│                                              │
│  Text block                                  │
│  Widget reference token                      │
│  Text block                                  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Message Renderer                             │
│ - Parses text                                │
│ - Detects widget references                  │
│ - Delegates widget mount to registry         │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Widget Registry                              │
│ - Maps widget name to React component        │
│ - Validates props                            │
│ - Resolves data-resource URI                 │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│ Finance Widget Component                     │
│ - Fetches/resolves resource payload          │
│ - Renders chart/table/card UI                │
│ - Handles empty/loading/error states         │
└──────────────────────────────────────────────┘
```

The key front-end primitive is a widget reference embedded inside a chat response.

Conceptually:

```tsx
<Message>
  <MarkdownText />
  <FinanceWidget ref="genui://data/70e9" />
  <MarkdownText />
</Message>
```

---

# 3. Widget data-resource flow

Finance widgets use a two-step flow.

## Step 1: Generate widget data

The Finance tool executes a widget-specific data query.

Example:

```json
{
  "query": {
    "source": "ledger_spend_by_category_source",
    "months_ago": 0,
    "excluded_primary_categories": ["income", "transfers"]
  }
}
```

The response returns:

```json
{
  "uri": "genui://data/70e9",
  "name": "ledger_spend_by_category_source",
  "data_type": "LedgerSpendByCategorySourceResult",
  "model_message": "Call ledger_spend_by_category_widget with ledger_spend_by_category_data=\"genui://data/70e9\""
}
```

## Step 2: Render widget with the returned resource

The UI renders a widget reference like:

```text
ledger_spend_by_category_widget
  ledger_spend_by_category_data="genui://data/70e9"
```

The front-end should treat the URI as an opaque data-resource reference. It should not parse business meaning out of the URI string.

---

# 4. Widget invocation contract

Finance widgets follow a consistent pattern:

```text
source query
→ data resource URI
→ widget component
```

The source determines what data payload is generated. The widget determines how the payload is rendered.

Examples:

| Source                                 | Widget                                  | Ref prop                             |
| -------------------------------------- | --------------------------------------- | ------------------------------------ |
| `ledger_recurring_transactions_source` | `ledger_recurring_transactions_widget`  | `ledger_recurring_data`              |
| `ledger_upcoming_activity_source`      | `ledger_upcoming_activity_widget`       | `ledger_upcoming_activity_data`      |
| `ledger_income_tracker_source`         | `ledger_income_tracker_widget`          | `ledger_income_tracker_data`         |
| `ledger_recent_transactions_source`    | `ledger_recent_transactions_widget`     | `ledger_recent_transactions_data`    |
| `ledger_fee_interest_paid_source`      | `ledger_fee_interest_paid_widget`       | `ledger_fee_interest_paid_data`      |
| `ledger_spend_by_category_source`      | `ledger_spend_by_category_widget`       | `ledger_spend_by_category_data`      |
| `ledger_spend_month_comparison_source` | `ledger_spend_so_far_this_month_widget` | `ledger_spend_month_comparison_data` |
| `ledger_net_worth_source`              | `ledger_net_worth_widget`               | `ledger_net_worth_data`              |
| `ledger_equity_updates_source`         | `ledger_equity_updates_widget`          | `ledger_equity_updates_data`         |
| `ledger_portfolio_distribution_source` | `ledger_portfolio_distribution_widget`  | `ledger_distribution_data`           |
| `ledger_account_breakdown_source`      | `ledger_account_breakdown_widget`       | `ledger_distribution_data`           |

The front-end registry should encode this mapping rather than relying on free-form component names.

---

# 5. Example: Spend by category widget

The spend-by-category widget receives a data resource with a shape similar to:

```ts
type LedgerSpendByCategorySourceResult = {
  title: string;
  month: string;
  total: string;
  total_spend: number;
  total_spend_label: string;
  time_frame_label: string;

  spend_by_category: LedgerSpendCategory[];
  segments: LedgerSpendSegment[];
  categories: LedgerSpendCategory[];
  top_categories: LedgerSpendCategory[];

  has_more_categories: boolean;
  month_views: LedgerMonthView[];
  month_option_groups: MonthOptionGroup[];
  selected_month_index: number;

  currency_conversion?: CurrencyConversionInfo;
};
```

A category item resembles:

```ts
type LedgerSpendCategory = {
  id: string;

  primary_category: string;
  primary_category_key: string;

  icon: string;
  color: string;

  amount: string;
  amount_value: number;

  pct: number;
  pct_label: string;
  pct_short_label: string;

  filled_pct: number;
  rest_pct: number;
  weight: number;

  top_detail_label?: string;
  top_detail_amount?: string;
  top_detail_share_label?: string;

  detail_sidebar_enabled: boolean;
  detail_sidebar_aria_label: string;
};
```

A segment item resembles:

```ts
type LedgerSpendSegment = {
  id: string;
  primary_category: string;
  color: string;
  weight: number;
};
```

The widget can use:

```text
segments
```

for the visual stacked bar or distribution chart, and:

```text
categories
```

for the detailed list.

The same payload may include:

```text
month_views
```

so the component can support switching between months without requiring a new server round-trip for each month.

---

# 6. Data payload design implications

The returned payload contains both machine-readable and display-ready values.

Example:

```json
{
  "amount": "$4,331.57",
  "amount_value": 4331.57,
  "pct": 52.4139808691759,
  "pct_label": "52% of spending",
  "pct_short_label": "52%"
}
```

This dual format is intentional.

The front-end can use:

```text
amount
pct_label
pct_short_label
```

for display, while using:

```text
amount_value
pct
weight
```

for sorting, charting, animation, or accessibility calculations.

Recommendation:

```text
Use server-provided display labels for financial formatting unless the product explicitly requires client-localized reformatting.
```

Reason: financial formatting is sensitive to currency, conversion, rounding, and account/provider context.

---

# 7. Rendering responsibilities

The widget component should own:

```text
layout
visual hierarchy
responsive behavior
accessibility labels
empty states
loading states
error states
interaction affordances
visual consistency
```

The data-resource layer should own:

```text
query execution
account scoping
category aggregation
currency conversion metadata
computed totals
percentage calculations
month grouping
```

The assistant text should own:

```text
plain-language interpretation
callouts
caveats
next-step suggestions
```

Avoid mixing these responsibilities. For example, a widget should not generate personalized financial advice, and the assistant should not manually redraw what the widget already renders.

---

# 8. Message rendering integration

A chat message may contain text and widget references interleaved.

Example conceptual message AST:

```ts
type MessageNode =
  | { type: "markdown"; content: string }
  | {
      type: "widget";
      widgetName: "ledger_spend_by_category_widget";
      props: {
        ledger_spend_by_category_data: "genui://data/70e9";
      };
    };
```

A renderer might look like:

```tsx
function ChatMessageRenderer({ nodes }: { nodes: MessageNode[] }) {
  return (
    <div className="message">
      {nodes.map((node, index) => {
        if (node.type === "markdown") {
          return <Markdown key={index}>{node.content}</Markdown>;
        }

        if (node.type === "widget") {
          return (
            <WidgetRenderer
              key={index}
              widgetName={node.widgetName}
              props={node.props}
            />
          );
        }

        return null;
      })}
    </div>
  );
}
```

Widget rendering should be isolated from markdown rendering. Never attempt to render widget references as raw markdown text.

---

# 9. Widget registry

A widget registry should provide a stable mapping:

```ts
const widgetRegistry = {
  ledger_spend_by_category_widget: LedgerSpendByCategoryWidget,
  ledger_recurring_transactions_widget: LedgerRecurringTransactionsWidget,
  ledger_upcoming_activity_widget: LedgerUpcomingActivityWidget,
  ledger_recent_transactions_widget: LedgerRecentTransactionsWidget,
  ledger_fee_interest_paid_widget: LedgerFeeInterestPaidWidget,
  ledger_net_worth_widget: LedgerNetWorthWidget,
  ledger_portfolio_distribution_widget: LedgerPortfolioDistributionWidget,
  ledger_account_breakdown_widget: LedgerAccountBreakdownWidget,
} as const;
```

The renderer can validate:

```ts
type WidgetName = keyof typeof widgetRegistry;

function WidgetRenderer({
  widgetName,
  props,
}: {
  widgetName: WidgetName;
  props: Record<string, unknown>;
}) {
  const Component = widgetRegistry[widgetName];

  if (!Component) {
    return <UnsupportedWidgetFallback widgetName={widgetName} />;
  }

  return <Component {...props} />;
}
```

For Finance widgets, the prop value should usually be a `genui://data/...` resource, not an expanded payload.

---

# 10. Data-resource resolution

A component can resolve the data resource in one of two ways, depending on platform architecture.

## Option A: host resolves resource before rendering

```tsx
function WidgetRenderer({ widgetName, props }: WidgetRendererProps) {
  const resolvedProps = useResolvedWidgetResources(props);

  const Component = widgetRegistry[widgetName];
  return <Component {...resolvedProps} />;
}
```

In this model, the widget receives actual data.

```tsx
<LedgerSpendByCategoryWidget data={resolvedData} />
```

## Option B: widget resolves its own resource

```tsx
function LedgerSpendByCategoryWidget({
  ledger_spend_by_category_data,
}: {
  ledger_spend_by_category_data: string;
}) {
  const { data, loading, error } = useGenUiDataResource(
    ledger_spend_by_category_data
  );

  if (loading) return <SpendByCategorySkeleton />;
  if (error) return <SpendByCategoryError />;
  if (!data) return <SpendByCategoryEmpty />;

  return <SpendByCategoryView data={data} />;
}
```

Either design can work. The main requirement is consistency. Mixing both patterns across widgets makes error handling and test coverage harder.

---

# 11. Loading states

Finance widgets should have explicit loading states because the data resource may resolve asynchronously.

Recommended loading behavior:

```text
show skeleton layout matching final widget dimensions
avoid layout shift
do not show fake financial numbers
avoid shimmer that implies live market movement
```

For a spend-by-category widget, a skeleton could include:

```text
title placeholder
total placeholder
stacked bar placeholder
4 to 6 category row placeholders
```

Front-end implementation:

```tsx
function SpendByCategorySkeleton() {
  return (
    <Card>
      <div className="h-5 w-40 rounded bg-muted" />
      <div className="mt-3 h-8 w-32 rounded bg-muted" />
      <div className="mt-4 h-3 w-full rounded bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>
    </Card>
  );
}
```

---

# 12. Empty states

Finance widgets can be empty for valid reasons:

```text
no connected accounts
no transactions in selected period
no recurring subscriptions detected
no investment holdings connected
account still syncing
filters excluded all data
```

Empty states should distinguish between:

```text
zero result
```

and:

```text
data unavailable
```

Good empty state:

```text
No subscriptions were detected from connected accounts for this period.
```

Better with context:

```text
No active subscriptions were detected. Some recently connected accounts may still be syncing older recurring activity.
```

Bad empty state:

```text
No data.
```

---

# 13. Error states

Error states should avoid exposing provider internals, stack traces, or sensitive metadata.

A front-end error component should show:

```text
Something went wrong loading this finance view.
Try refreshing or reconnecting the account.
```

It should not show:

```text
Plaid error code
provider token details
raw account IDs
internal service exception
```

Recommended error shape:

```ts
type WidgetError = {
  kind:
    | "resource_not_found"
    | "resource_expired"
    | "permission_denied"
    | "provider_unavailable"
    | "sync_incomplete"
    | "unknown";
  userMessage: string;
  retryable: boolean;
};
```

---

# 14. Accessibility requirements

Finance widgets need strong accessibility because they often include charts, percentages, and dense tabular data.

For a spend-by-category visualization:

```text
Do not rely on color alone.
Expose category names, amounts, and percentages as text.
Provide aria-labels for chart segments.
Ensure keyboard navigation for month selectors.
Ensure screen readers can access totals.
```

Example aria label:

```tsx
<div
  role="img"
  aria-label="Spend by category for May. Total spending 8,264 dollars and 15 cents. Housing 52 percent, Financial 14 percent, Travel 9 percent."
>
  <StackedBar segments={segments} />
</div>
```

For category rows:

```tsx
<li aria-label="Housing, $4,331.57, 52 percent of spending">
  ...
</li>
```

The payload often includes display strings like:

```text
pct_label: "52% of spending"
top_detail_share_label: "100% of this category"
```

Use those where possible.

---

# 15. Responsive design

Finance widgets must fit in a chat container, not a full dashboard canvas.

Design constraints:

```text
variable message width
mobile-first layout
long merchant/category names
large currency values
dark/light themes
possibly nested inside scrollable conversation
```

Recommended behavior:

```text
Use single-column layout on mobile.
Use compact category rows.
Collapse secondary details.
Avoid wide tables unless horizontally scrollable.
Pin totals at top.
Use progressive disclosure for long lists.
```

For mobile, prefer:

```text
stacked cards
short labels
truncated merchant names with accessible full labels
tap-to-expand details
```

For desktop, allow:

```text
side-by-side summaries
expanded category lists
hover affordances
larger charts
```

---

# 16. Privacy-sensitive rendering

Finance widgets display highly sensitive data. Front-end design should minimize accidental exposure.

Recommended safeguards:

```text
Do not expose raw account IDs.
Avoid showing full account numbers.
Mask account details.
Avoid over-rendering raw transaction names.
Avoid leaking hidden metadata into DOM attributes.
Avoid logging widget payloads to client analytics.
Avoid putting sensitive values in URLs.
```

Be careful with:

```tsx
data-* attributes
console logs
error telemetry
session replay tools
third-party analytics
DOM snapshots
```

A common mistake is to hide data visually but still expose it in the DOM. For sensitive finance views, collapsed or hidden content should not include full raw data unless needed.

---

# 17. Currency and localization

Finance widget payloads may include both formatted and numeric values.

Example:

```json
{
  "amount": "$4,331.57",
  "amount_value": 4331.57,
  "currency_conversion": {
    "display_currency_code": "USD",
    "converted_currency_codes": [],
    "omitted_currency_codes": []
  }
}
```

Front-end rule:

```text
Prefer server-provided formatted labels for display.
Use numeric fields for chart geometry and sorting.
```

If client-side formatting is required, use a centralized money formatter:

```ts
function formatMoney(value: number, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(value);
}
```

But avoid reformatting already formatted labels unless the component has a clear localization requirement.

---

# 18. Interaction patterns

Finance widgets may support interactions such as:

```text
month switching
category expansion
merchant drilldown
transaction detail sidebar
account filtering
sort toggles
time-range selection
```

The data payload may include flags such as:

```text
detail_sidebar_enabled
detail_sidebar_aria_label
has_more_categories
month_option_groups
selected_month_index
```

These should be treated as UI capability flags.

Example:

```tsx
{category.detail_sidebar_enabled ? (
  <button aria-label={category.detail_sidebar_aria_label}>
    <CategoryRow category={category} />
  </button>
) : (
  <CategoryRow category={category} />
)}
```

Do not assume every category row is clickable.

---

# 19. Month selector pattern

The spend-by-category payload can include multiple month views:

```ts
type MonthOptionGroup = {
  label: string; // "2026"
  options: Array<{
    label: string; // "May"
    value: string; // "0"
  }>;
};
```

The widget can render grouped month options:

```tsx
<Select value={String(selectedMonthIndex)} onValueChange={setMonthIndex}>
  {month_option_groups.map((group) => (
    <SelectGroup key={group.label}>
      <SelectLabel>{group.label}</SelectLabel>
      {group.options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectGroup>
  ))}
</Select>
```

When a user changes the month, the widget can either:

```text
1. Switch locally to a month_view already included in payload.
2. Trigger a new widget query for that month.
```

The first option is faster and avoids extra data fetches. The second option is better if the payload would become too large.

---

# 20. Recommended component decomposition

For a spend-by-category widget:

```text
LedgerSpendByCategoryWidget
  ├─ WidgetCard
  ├─ Header
  │   ├─ Title
  │   ├─ MonthSelector
  │   └─ TotalSpend
  ├─ CategoryDistributionBar
  │   └─ Segment
  ├─ TopCategoryList
  │   └─ CategoryRow
  ├─ MoreCategoriesDisclosure
  └─ Footnote / CurrencyConversionNote
```

Example TypeScript sketch:

```tsx
type LedgerSpendByCategoryWidgetProps = {
  ledger_spend_by_category_data: string;
};

export function LedgerSpendByCategoryWidget({
  ledger_spend_by_category_data,
}: LedgerSpendByCategoryWidgetProps) {
  const resource = useGenUiDataResource<LedgerSpendByCategorySourceResult>(
    ledger_spend_by_category_data
  );

  if (resource.status === "loading") return <SpendByCategorySkeleton />;
  if (resource.status === "error") return <FinanceWidgetError />;
  if (!resource.data) return <SpendByCategoryEmpty />;

  return <SpendByCategoryView data={resource.data} />;
}
```

View component:

```tsx
function SpendByCategoryView({
  data,
}: {
  data: LedgerSpendByCategorySourceResult;
}) {
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(
    data.selected_month_index
  );

  const selectedMonth =
    data.month_views?.[selectedMonthIndex] ?? data.month_views?.[0];

  const view = selectedMonth ?? data;

  return (
    <section aria-labelledby="spend-by-category-title">
      <header>
        <h2 id="spend-by-category-title">{data.title}</h2>
        <p>{view.total}</p>
      </header>

      <CategoryDistributionBar segments={view.segments} />

      <ul>
        {view.top_categories.map((category) => (
          <CategoryRow key={category.id} category={category} />
        ))}
      </ul>
    </section>
  );
}
```

---

# 21. Visual encoding

Finance widgets should use restrained visual encoding.

For spend categories:

```text
segment length = percentage of spend
row order = descending amount
primary value = amount
secondary value = percent of spending
icon = semantic category indicator
color = category differentiation
```

Avoid:

```text
overly saturated colors
3D charts
pie charts with too many slices
unlabeled color-only legends
unrounded financial figures where labels are expected
```

Use:

```text
compact bars
clear row labels
amount-first hierarchy
secondary percentages
plain-language category names
```

---

# 22. Testing strategy

Front-end engineers should test Finance widgets across four levels.

## 22.1 Schema tests

Validate that the widget accepts the expected payload shape.

```ts
expect(data.total_spend).toEqual(expect.any(Number));
expect(data.categories).toEqual(expect.any(Array));
expect(data.month_views).toEqual(expect.any(Array));
```

## 22.2 Rendering tests

Validate visible output.

```tsx
render(<SpendByCategoryView data={mockData} />);

expect(screen.getByText("Spend by category")).toBeInTheDocument();
expect(screen.getByText("$8,264.15")).toBeInTheDocument();
expect(screen.getByText("Housing")).toBeInTheDocument();
```

## 22.3 Accessibility tests

Validate labels and keyboard access.

```tsx
expect(
  screen.getByLabelText(/spend by category for may/i)
).toBeInTheDocument();
```

## 22.4 Edge-case tests

Test:

```text
zero categories
one category with 100%
many categories
very long category names
very large amounts
negative or zero values if present
missing currency conversion note
stale resource
permission error
```

---

# 23. Common implementation pitfalls

## Pitfall 1: Treating `genui://data/...` as a URL

It is a resource identifier, not a normal web URL.

Do not do:

```ts
fetch("genui://data/70e9");
```

unless the platform explicitly provides a resolver that supports that scheme.

Use the platform resource resolver.

## Pitfall 2: Recomputing financial totals client-side

Do not recompute totals unless necessary. The backend may already apply:

```text
account scoping
filtering
currency conversion
category exclusion
rounding
normalization
```

Client recomputation can create mismatches.

## Pitfall 3: Assuming every row is clickable

Use capability flags such as:

```text
detail_sidebar_enabled
```

Do not infer interactivity from row presence.

## Pitfall 4: Exposing sensitive data to analytics

Avoid logging full payloads.

Bad:

```ts
analytics.track("widget_loaded", { data });
```

Better:

```ts
analytics.track("widget_loaded", {
  widgetName: "ledger_spend_by_category_widget",
  categoryCount: data.categories.length,
  hasCurrencyConversion: Boolean(data.currency_conversion),
});
```

## Pitfall 5: Showing unsupported widgets as broken markdown

If a widget name is unknown, show a graceful fallback.

```tsx
function UnsupportedWidgetFallback() {
  return (
    <Card>
      <p>This finance view is not available in this version of the app.</p>
    </Card>
  );
}
```

---

# 24. Front-end security checklist

For every Finance widget, review:

```text
Does the component expose raw account IDs?
Does it leak data into logs?
Does it render hidden sensitive data?
Does it support masked account labels?
Does it avoid third-party image/script leakage?
Does it handle permission errors safely?
Does it avoid storing payloads in localStorage?
Does it avoid putting financial data into URL params?
Does it support redaction in screenshots/session replay?
```

Finance UI should be treated as a sensitive surface, closer to healthcare or identity data than ordinary product analytics.

---

# 25. Performance considerations

Finance widgets may contain many rows, month views, or historical comparisons.

Front-end considerations:

```text
virtualize long transaction lists
memoize sorted/derived views
avoid recalculating percentages repeatedly
lazy-load detail drawers
defer offscreen widgets
avoid hydration mismatches for formatted currency
```

For chart rendering:

```text
SVG is fine for small charts
Canvas may be better for very large transaction timelines
CSS bars are often enough for category distribution
```

In chat, most Finance widgets should be compact. Avoid rendering a full dashboard inside a message bubble.

---

# 26. Design system considerations

Finance widgets should feel native to the broader app.

Recommended design primitives:

```text
Card
Heading
Metric
Segmented bar
List row
Icon
Badge
Disclosure
Select
Tooltip
Drawer
Skeleton
Inline error
```

Financial UI hierarchy:

```text
1. What is the total?
2. What period is this for?
3. What are the top drivers?
4. What changed or matters?
5. Can the user drill deeper?
```

A spend widget should not lead with a complex chart. It should lead with:

```text
May spending: $8,264.15
Top category: Housing
Next largest: Financial
```

Then show supporting visuals.

---

# 27. Recommended TypeScript contracts

A front-end engineer should keep widget contracts explicit.

Example:

```ts
type CurrencyConversionInfo = {
  display_currency_code: string;
  converted_currency_codes: string[];
  omitted_currency_codes: string[];
  rate_as_of_by_currency: Record<string, string>;
  currency_conversion_note: string | null;
};

type LedgerSpendCategory = {
  id: string;
  primary_category: string;
  primary_category_key: string;
  detail_sidebar_enabled: boolean;
  detail_sidebar_aria_label: string;
  icon: string;
  amount: string;
  amount_value: number;
  pct: number;
  pct_label: string;
  pct_short_label: string;
  filled_pct: number;
  rest_pct: number;
  color: string;
  weight: number;
  top_detail_label?: string;
  top_detail_amount?: string;
  top_detail_share_label?: string;
};

type LedgerSpendSegment = {
  id: string;
  primary_category: string;
  color: string;
  weight: number;
};

type LedgerMonthView = {
  option_label: string;
  option_value: string;
  month_start: string;
  month: string;
  total: string;
  segments: LedgerSpendSegment[];
  categories: LedgerSpendCategory[];
  top_categories: LedgerSpendCategory[];
  has_more_categories: boolean;
};

type LedgerSpendByCategorySourceResult = {
  title: string;
  month: string;
  total: string;
  label: string;
  total_spend: number;
  total_spend_label: string;
  time_frame_label: string;
  spend_by_category: LedgerSpendCategory[];
  segments: LedgerSpendSegment[];
  categories: LedgerSpendCategory[];
  top_categories: LedgerSpendCategory[];
  has_more_categories: boolean;
  month_views: LedgerMonthView[];
  month_option_groups: Array<{
    label: string;
    options: Array<{ label: string; value: string }>;
  }>;
  selected_month_index: number;
  currency_conversion: CurrencyConversionInfo;
};
```

Keep these contracts close to the widget implementation and validate them at runtime when possible.

---

# 28. Recommended review checklist

Before shipping a Finance widget, review:

```text
Data contract
- Is the expected resource prop documented?
- Are required and optional fields typed?
- Are display labels and numeric values used correctly?

Rendering
- Does the widget handle loading, empty, error, and success states?
- Does it avoid layout shift?
- Does it fit mobile chat width?

Privacy
- Are account IDs masked or omitted?
- Are raw payloads excluded from logs?
- Is sensitive hidden content actually not rendered?

Accessibility
- Are chart values available to screen readers?
- Are controls keyboard accessible?
- Is color not the only signal?

Correctness
- Are totals server-provided rather than recomputed incorrectly?
- Are percentages rounded consistently?
- Are excluded categories reflected correctly?

Resilience
- Does it handle expired data resources?
- Does it handle missing fields gracefully?
- Does it degrade if the widget type is unsupported?
```

---

# 29. Conclusion

Finance UI for enabled Finance features is best understood as a resource-backed widget rendering system embedded inside conversation.

The front-end should not treat Finance widgets as ordinary markdown, and it should not treat widget data URIs as public URLs or raw API endpoints. Instead, each widget should be rendered through a controlled registry that resolves a Finance data resource into a typed, privacy-sensitive UI component.

The core design principle is:

```text
The Finance backend computes financial facts.
The widget renders those facts clearly.
The assistant explains what the facts mean.
```

That separation keeps the system maintainable, testable, secure, and understandable for users.

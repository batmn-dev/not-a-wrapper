# Technical Execution Article: Using a Normalized Personal Finance Query Layer to Identify Spending Reduction Opportunities

## Executive summary

This article describes the technical workflow used to analyze personal financial data and identify opportunities to reduce spending, subscriptions, and fees. The analysis was not performed by directly connecting to raw bank APIs or manually scraping account statements. Instead, it used a normalized financial data interface exposed through a Finances connector.

The execution pattern was:

```text
User request
→ Finances connector
→ normalized financial data model
→ typed query execution
→ structured results / CSV attachments / widget data resources
→ assistant-side interpretation and ranking
```

The core technical approach combined five types of analysis:

1. **Account coverage validation** to determine which institutions and accounts were available.
2. **Transaction aggregation** to compute year-to-date spend by category.
3. **Merchant aggregation** to surface high-impact vendors and repeated leakage.
4. **Recurring stream analysis** to identify subscriptions, bills, and predicted future payments.
5. **Liability analysis** to evaluate balances, APRs, minimum payments, and interest exposure.

The key architectural point is that the analysis was executed against a normalized ledger abstraction, not against institution-specific schemas. This made it possible to query Chase, AmEx, Citi, Wells Fargo, Discover, SoFi, and Capital One data through a consistent interface.

---

## 1. System context

The user asked:

> Where could I reduce spending, subscriptions, or fees this year?

That request required access to personal financial data, so the workflow routed through the Finances connector.

The connector exposed several typed resources, including:

```text
get_linked_accounts
query
run_widget_query
```

The primary data domains used were:

```text
transactions
recurring_transactions
liabilities
```

Each domain behaved like a typed table or model with filterable fields, sortable fields, selected columns, grouping support, and aggregations.

The analysis did not require raw bank logins, CSV uploads from the user, or manual account export. The connector returned normalized data already enriched with fields such as merchant names, categories, recurring stream metadata, and liability attributes.

---

## 2. Data model used

### 2.1 Transactions

The `transactions` query type represents posted or pending account activity.

Relevant fields included:

```text
date
amount
name
merchant_name
account_name
personal_finance_category_primary
personal_finance_category_detailed
```

For this analysis, `transactions` was used for:

```text
year-to-date category totals
year-to-date merchant totals
financial-fee and interest-charge inspection
```

### 2.2 Recurring transactions

The `recurring_transactions` query type represents modeled recurring streams. These are not simply duplicate transaction rows. They are detected recurring patterns with normalized metadata.

Relevant fields included:

```text
description
merchant_name
flow_type
frequency
average_amount
last_amount
predicted_next_date
is_active
status
recurring_transaction_type
personal_finance_category_primary
```

This model was used to identify:

```text
subscriptions
bills
loan payments
rent
membership charges
recurring interest charges
future predicted payments
```

### 2.3 Liabilities

The `liabilities` query type represents credit cards, loans, mortgages, and other debt instruments where available.

Relevant fields included:

```text
account_name
liability_type
last_statement_balance
minimum_payment_amount
next_payment_due_date
aprs_apr_percentage
aprs_apr_type
aprs_balance_subject_to_apr
aprs_interest_charge_amount
```

This model was used to determine whether spending-reduction recommendations should prioritize small recurring subscriptions or larger debt-interest leakage.

---

## 3. Account coverage validation

The first technical step was to inspect linked accounts.

The connector call was conceptually:

```text
get_linked_accounts()
```

This returned a list of connected institutions and accounts. The visible coverage included:

```text
SoFi
Discover
Wells Fargo
Citibank
American Express
Capital One
Chase
```

The purpose of this step was not merely informational. It established the scope of the analysis.

Without account coverage validation, the results could be misinterpreted as a complete financial picture. Instead, the analysis should be understood as:

```text
Findings based on currently connected and synced accounts.
```

This distinction matters because unconnected accounts, stale syncs, or delayed transaction backfills can affect totals.

---

## 4. Query execution model

The main query interface accepts a batch of independent query objects:

```json
{
  "queries": [
    {
      "query_type": "transactions"
    },
    {
      "query_type": "recurring_transactions"
    },
    {
      "query_type": "liabilities"
    }
  ]
}
```

Each query object is strongly shaped by its `query_type`.

At a high level, the execution model resembles SQL, though it is exposed as structured JSON:

```text
filter
→ select fields
→ group by
→ aggregate
→ order
→ limit
```

For example, a transaction aggregation query can include:

```json
{
  "query_type": "transactions",
  "date": {
    "op": "gte",
    "val": "2026-01-01"
  },
  "amount": {
    "op": "gt",
    "val": 0
  },
  "group_by_fields": ["personal_finance_category_primary"],
  "aggregations": [
    {
      "op": "sum",
      "field": "amount",
      "alias": "total_spend"
    },
    {
      "op": "count",
      "alias": "transaction_count"
    }
  ],
  "order_by_field": "total_spend",
  "order_by_direction": "desc"
}
```

Conceptually, this is equivalent to:

```sql
SELECT
  personal_finance_category_primary,
  SUM(amount) AS total_spend,
  COUNT(*) AS transaction_count
FROM transactions
WHERE date >= '2026-01-01'
  AND amount > 0
GROUP BY personal_finance_category_primary
ORDER BY total_spend DESC;
```

---

## 5. Year-to-date spend analysis

### 5.1 Filter design

The analysis focused on the current year, using:

```json
"date": {
  "op": "gte",
  "val": "2026-01-01"
}
```

To isolate outflows, the query used:

```json
"amount": {
  "op": "gt",
  "val": 0
}
```

The assumption here is that, in this normalized ledger, positive transaction amounts represent money leaving the user’s accounts. This is common in many personal finance data models, though it is an important assumption to document.

### 5.2 Grouping by category

The category aggregation grouped transactions by:

```json
"group_by_fields": ["personal_finance_category_primary"]
```

It calculated:

```json
[
  {
    "op": "sum",
    "field": "amount",
    "alias": "total_spend"
  },
  {
    "op": "count",
    "alias": "transaction_count"
  }
]
```

A representative current snapshot returned the following top categories:

| Category        | Total spend | Transaction count |
| --------------- | ----------: | ----------------: |
| Housing         |  $21,895.47 |                 5 |
| Travel          |  $15,834.98 |                20 |
| Financial       |  $11,442.53 |                73 |
| Shopping        |   $7,886.92 |                45 |
| Dining & drinks |   $5,832.39 |               126 |

This query helped identify high-level reduction opportunities. It showed that spending reduction should not be framed only as “cancel subscriptions.” Larger categories, especially financial, shopping, and dining, required deeper investigation.

---

## 6. Merchant-level analysis

The second transaction aggregation used the same date and outflow filters but grouped by merchant:

```json
"group_by_fields": ["merchant_name"]
```

Conceptual SQL:

```sql
SELECT
  merchant_name,
  SUM(amount) AS total_spend,
  COUNT(*) AS transaction_count
FROM transactions
WHERE date >= '2026-01-01'
  AND amount > 0
GROUP BY merchant_name
ORDER BY total_spend DESC
LIMIT 50;
```

This merchant-level view is necessary because category totals can hide actionable patterns.

For example:

```text
Shopping → too broad
Merchant view → Costco, Instacart, Amazon, Apple
```

Similarly:

```text
Financial → too broad
Merchant view → purchase interest charges, loan payments, bank fees
```

The merchant aggregation was used to distinguish between:

```text
large one-time purchases
recurring vendor patterns
interest leakage
convenience spending
travel spikes
subscription vendors
```

This is where high-impact merchants and merchant-label variants surfaced.

---

## 7. Recurring transaction analysis

### 7.1 Active recurring outflows

The recurring query was structured as:

```json
{
  "query_type": "recurring_transactions",
  "flow_type": "outflow",
  "is_active": true,
  "select_fields": [
    "description",
    "merchant_name",
    "frequency",
    "average_amount",
    "last_amount",
    "predicted_next_date",
    "personal_finance_category_primary"
  ],
  "order_by_field": "average_amount",
  "order_by_direction": "desc"
}
```

This query identified active recurring streams, sorted by average amount.

A representative output included:

| Description                 | Frequency | Average amount | Type         |
| --------------------------- | --------: | -------------: | ------------ |
| Bilt rent                   |   Monthly |      $4,151.62 | Rent         |
| SoFi personal loan          |   Monthly |        $929.29 | Bill         |
| California DMV registration |  Annually |        $505.50 | Bill         |
| Purchase interest charge    |   Monthly |        $415.88 | Other        |
| LegalZoom Registered Agent  |  Annually |        $399.00 | Subscription |

The important technical detail is that this query operates on recurring streams, not isolated transaction rows. The data includes predicted next dates and normalized average amounts, which makes it useful for forward-looking spend reduction.

### 7.2 Why recurring streams matter

A standard transaction query can tell you:

```text
What already happened?
```

A recurring stream query can tell you:

```text
What is likely to happen again?
When is it likely to happen?
How often does it happen?
What is the normalized amount?
```

That makes it more appropriate for subscription analysis and future savings estimates.

---

## 8. Subscription-specific widget execution

For the subscription visualization, I used a specialized widget query:

```json
{
  "source": "ledger_recurring_transactions_source",
  "flow_type": "outflow",
  "recurring_transaction_category": "subscription",
  "income_only": false
}
```

This returned a GenUI data resource:

```text
genui://data/...
```

That resource was then rendered by the corresponding subscription widget.

The widget data included normalized subscription totals:

```text
estimated_monthly_total: $803.86
annual_total: $9,646.36
```

This is different from the generic recurring transaction query. The widget query applied a subscription-specific lens and normalized the billing cadences into monthly and annual views.

For example:

```text
monthly subscription → monthly amount
annual subscription → annual amount / 12 for monthly estimate
quarterly subscription → quarterly amount / 3 for monthly estimate
```

The normalization was handled by the widget backend, not manually recomputed in Python.

---

## 9. Financial leakage analysis

To isolate fees, interest, and other financial outflows, I queried transactions where:

```json
"personal_finance_category_primary": "financial"
```

The query selected row-level details:

```json
{
  "query_type": "transactions",
  "date": {
    "op": "gte",
    "val": "2026-01-01"
  },
  "amount": {
    "op": "gt",
    "val": 0
  },
  "personal_finance_category_primary": "financial",
  "select_fields": [
    "date",
    "name",
    "merchant_name",
    "amount",
    "account_name",
    "personal_finance_category_primary",
    "personal_finance_category_detailed"
  ],
  "order_by_field": "date",
  "order_by_direction": "desc"
}
```

Conceptual SQL:

```sql
SELECT
  date,
  name,
  merchant_name,
  amount,
  account_name,
  personal_finance_category_detailed
FROM transactions
WHERE date >= '2026-01-01'
  AND amount > 0
  AND personal_finance_category_primary = 'financial'
ORDER BY date DESC;
```

This query was used to find:

```text
purchase interest charges
interest charge on purchases
bank fees
wire fees
insurance
government fees
loan payments
financial/accounting services
```

The main insight from this step was that interest charges were a much larger optimization target than many individual subscriptions.

---

## 10. Liability and APR analysis

The liability query provided credit account context:

```json
{
  "query_type": "liabilities",
  "liability_type": "credit",
  "select_fields": [
    "account_name",
    "last_statement_balance",
    "minimum_payment_amount",
    "next_payment_due_date",
    "aprs_apr_percentage",
    "aprs_apr_type"
  ]
}
```

A representative snapshot included purchase APRs such as:

| Account                     | Last statement balance | Purchase APR |
| --------------------------- | ---------------------: | -----------: |
| Citi Diamond Preferred Card |              $3,707.97 |       27.24% |
| Personal CC FreedomF        |              $1,481.43 |       24.24% |
| Blue Business Cash          |             $14,210.75 |       26.74% |
| Chase CREDIT CARD           |              $9,218.77 |       23.49% |
| Personal CC Amazon          |              $6,151.41 |       24.49% |

This liability data allowed the analysis to connect observed interest charges to underlying balances and APR exposure.

The practical logic was:

```text
High APR
+ non-trivial statement balance
+ recurring interest-charge transactions
= high-priority reduction opportunity
```

That is why the final recommendation prioritized credit card interest above subscription cancellation.

---

## 11. CSV behavior and result materialization

Some query responses returned structured JSON directly. Others returned CSV attachments when the result set was larger.

The tool response pattern looked like:

```text
Full query output is attached as CSV.
Use python to load /mnt/data/...
A small preview is included below.
```

This means the connector materialized the larger query result into a CSV file and provided preview rows in the response.

Important clarification:

```text
The CSV files were generated by the Finances query tool.
They were not manually created or manually loaded with Python during the original answer.
```

If a reproducibility workflow were desired, those CSVs could be loaded with pandas:

```python
import pandas as pd

recurring = pd.read_csv("/mnt/data/ledger_recurring_transactions_....csv")
financial = pd.read_csv("/mnt/data/ledger_transactions_....csv")

top_recurring = (
    recurring
    .sort_values("average_amount", ascending=False)
    .head(25)
)

financial_by_merchant = (
    financial
    .groupby("merchant_name", dropna=False)["amount"]
    .sum()
    .sort_values(ascending=False)
)
```

But the original analysis did not require that manual Python step because the connector already returned the needed aggregates and previews.

---

## 12. Recommendation ranking logic

After query execution, the analysis shifted from retrieval to interpretation.

The ranking model was not a machine learning model. It was a deterministic reasoning framework based on:

```text
absolute dollar magnitude
recurrence
controllability
avoidability
future impact
```

The ranking logic can be expressed as:

```text
For each spending area:
  1. Estimate annualized or year-to-date magnitude.
  2. Determine whether the spend is recurring or one-time.
  3. Determine whether the user can reasonably control or eliminate it.
  4. Prioritize high-dollar recurring and avoidable costs.
```

The resulting prioritization was:

| Rank | Area                 | Technical signal                         | Reason                                  |
| ---: | -------------------- | ---------------------------------------- | --------------------------------------- |
|    1 | Credit card interest | Financial transactions + APR liabilities | High-dollar, recurring, avoidable       |
|    2 | Subscriptions        | Recurring stream + subscription widget   | Recurring, cancellable                  |
|    3 | Dining and drinks    | Category aggregation                     | High frequency, behaviorally adjustable |
|    4 | Shopping/convenience | Merchant aggregation                     | Large but mixed essential/discretionary |
|    5 | Fees                 | Financial transaction details            | Lower magnitude but easy to eliminate   |

The CTO-relevant point: the final output was not a simple sorted list of subscriptions. It was a cross-domain synthesis across transactions, recurring streams, and liabilities.

---

## 13. Automated vs. assistant-side responsibilities

### Automated by the Finances layer

The Finances connector handled:

```text
institution connection abstraction
account normalization
transaction normalization
merchant enrichment
category classification
recurring stream detection
subscription classification
billing cadence normalization
liability retrieval
APR retrieval
aggregation execution
CSV materialization for large result sets
widget data-resource generation
```

### Performed by the assistant

The assistant handled:

```text
query selection
filter design
grouping strategy
aggregation strategy
cross-query comparison
impact ranking
interpretation of financial leakage
plain-English summarization
```

This separation matters. The connector supplied the structured financial facts; the assistant composed those facts into a decision-oriented analysis.

---

## 14. Data freshness and consistency considerations

The data can change between runs because financial connections may continue syncing, enriching, or backfilling transactions.

For example, a category total returned in one query may differ slightly from a later query if:

```text
new transactions sync
pending transactions post
merchant enrichment updates
category classification changes
recurring detection refreshes
account balances update
```

This is why small differences appeared between the first answer and the later representative snapshot.

A production-grade implementation should include:

```text
query timestamp
source account coverage
sync status
data freshness marker
pending vs posted transaction handling
versioned categorization rules
```

Without those controls, repeated analysis may produce slightly different totals over time.

---

## 15. Security and privacy posture

From a technical review perspective, the workflow minimized unnecessary data exposure by using aggregate queries where possible.

For example:

```text
Spend by category → aggregated rows
Spend by merchant → aggregated rows
Liability review → selected fields only
Financial leakage → detailed rows only where needed
```

A stricter implementation could further enforce:

```text
field minimization
masked account identifiers
redaction of raw transaction names
role-based data access
audit logging
ephemeral result retention
explicit user consent per analysis scope
```

The analysis did not require downloading bank statements or exporting full raw account histories.

---

## 16. Potential production architecture

A production-grade version of this analysis could be structured as a pipeline:

```text
1. Account coverage check
2. Data freshness validation
3. Transaction aggregation
4. Merchant aggregation
5. Recurring stream analysis
6. Liability/APR analysis
7. Interest and fee detection
8. Savings opportunity scoring
9. Recommendation generation
10. User-facing report
```

A possible service-level architecture:

```text
Client
  → Finance Analysis API
    → Account Coverage Service
    → Transaction Query Service
    → Recurring Stream Service
    → Liability Service
    → Scoring Engine
    → Report Generator
```

The scoring engine could define a savings opportunity score:

```text
score =
  annualized_amount
  × recurrence_weight
  × controllability_weight
  × confidence_weight
```

Example weights:

```text
credit card interest: high recurrence, high avoidability, high confidence
subscriptions: high recurrence, high controllability, medium-to-high confidence
dining: high controllability, medium confidence
shopping: medium controllability, medium confidence
fees: high controllability, lower magnitude
```

---

## 17. Reproducibility notes

To reproduce the analysis, a technical reviewer would need:

1. Account coverage output from `get_linked_accounts`.
2. Category aggregation query output.
3. Merchant aggregation query output.
4. Recurring outflow query output.
5. Subscription widget data output.
6. Financial-category transaction detail output.
7. Liability query output.
8. Query execution timestamp.
9. Sync status for each institution.
10. Treatment rules for pending transactions and positive/negative amount semantics.

A reproducible runbook would look like:

```text
Step 1: Validate connected institutions and sync status.
Step 2: Query YTD outflows by category.
Step 3: Query YTD outflows by merchant.
Step 4: Query active recurring outflows.
Step 5: Query subscription-specific recurring streams.
Step 6: Query financial-category YTD transactions.
Step 7: Query liabilities and APRs.
Step 8: Normalize annual impact.
Step 9: Rank opportunities.
Step 10: Generate report with caveats.
```

---

## 18. Limitations

The analysis has several technical limitations:

```text
It only covers connected accounts.
It depends on current sync completeness.
It depends on category and merchant enrichment quality.
It may include business and personal transactions together if both are connected.
It may classify some recurring streams imperfectly.
It does not prove whether a subscription is unused.
It does not know user intent or business necessity.
It does not automatically execute cancellations or payments.
```

A CTO reviewing this workflow should treat it as a decision-support pipeline, not an autonomous financial optimization engine.

---

## 19. Conclusion

The technical execution relied on a normalized financial query layer that exposed transactions, recurring streams, and liabilities through structured query objects. The analysis combined aggregate transaction queries, recurring payment detection, subscription normalization, and APR-aware liability context.

The most important technical design choice was cross-domain synthesis. A subscription-only analysis would have produced a list of cancellable services. A transaction-only analysis would have produced category and merchant totals. A liability-only analysis would have shown balances and APRs.

The value came from combining all three:

```text
transactions show where money went
recurring streams show what will likely continue
liabilities show where interest leakage is compounding
```

That is why the final recommendation prioritized credit card interest first, subscriptions second, and discretionary categories after that.

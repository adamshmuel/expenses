# 02 — Dashboard (`/dashboard`)

Status: **approved.**

## Purpose

Show the user what they have been spending, based on the expenses saved from the
chat screen. **Read-only.** Every change — recording, editing, deleting an
expense; adding, renaming, deleting, or resetting a category — happens in the
chat on `/home` ([01-ai-chat.md](01-ai-chat.md)). The dashboard has no edit or
delete controls of its own.

Because all changes happen elsewhere, on `/home`, the dashboard refetches its
data whenever the user returns to it, so it never shows stale numbers after a
change made in the chat.

## What it shows

In scope for v1:

| # | Statistic | Notes |
|---|---|---|
| 1 | Total spent in the selected period | The basic number |
| 2 | Number of expenses in the period | Stat tile next to the total |
| 3 | Number of distinct categories used in the period | Stat tile next to the total |
| 4 | Breakdown by category | The most useful view — numbers and lists, no chart |
| 5 | List of recent expenses | Also proves the data is really saved |

Both stat tiles (2, 3) are computed client-side, from data the dashboard
already fetches for the period — no extra request, no server change:

- Number of expenses = the length of the `GET /expenses?from=&to=` array
  (already fetched for the recent-expenses list).
- Categories used = the number of rows in the `GET /expenses/summary` response
  (already fetched for the breakdown) — one row per category with at least one
  expense in the period.

Not in v1: comparison with the previous period, and a "largest single expense"
stat (considered, dropped — not worth the extra request/complexity for what it
tells the user). Both are v2 candidates.

Totals are computed by MongoDB (`getExpenseTotalByCategory`'s
`$group`/`$sum` aggregation, [08-expense-category-dal.md](08-expense-category-dal.md)),
not looped over in server JS — course topic: aggregation.

### Breakdown by category: main/subcategory rollup

`getExpenseTotalByCategory` returns one flat total per leaf category id — it
does not know which categories are subcategories of which. The dashboard
groups those flat totals into the two-level shape the design calls for:

- One row per **main category**, showing its own total *plus every one of its
  subcategories' totals added in*.
- Clicking a main category row expands it to show its subcategories
  underneath, each with its own (non-rolled-up) total.
- Each main category row also shows its % share of the period's total spend.

This is entirely a **client-side** grouping step, done in `client/` after both
requests resolve — no server change:

1. `GET /categories` — gives every category with its `parent` field, so the
   client can build a parent → children map.
2. `GET /expenses/summary` — gives flat `{ _id: categoryId, total }` rows.
3. The client walks the flat totals: a subcategory's total is added to its
   parent's rolled-up total; a main category with no expenses of its own
   still appears if any of its subcategories have spend.
4. % share = a main category's rolled-up total ÷ the period's overall total.

No new endpoint, no aggregation change. `getExpenseTotalByCategory` stays as
it is.

Period selector: today / this week / this month / a past month (month picker) /
a custom date range (two date pickers). All five feed the same `from`/`to`
range into `getExpenseTotalByCategory` ([08-expense-category-dal.md](08-expense-category-dal.md),
[09-expense-category-service.md](09-expense-category-service.md) §5) — purely a
client-side choice of how `from`/`to` gets computed, no server change.

## Cases the screen must handle

| Case | Behaviour |
|---|---|
| No expenses saved yet | An empty state, not a broken chart |
| Loading | A loading indicator |
| The request fails | An error message, with a way to retry |

## Open questions

None.

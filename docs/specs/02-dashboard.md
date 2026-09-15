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
| 2 | Breakdown by category | The most useful view — numbers and lists, no chart |
| 3 | List of recent expenses | Also proves the data is really saved |

Not in v1: comparison with the previous period. A v2 candidate.

Totals are computed by MongoDB (`getExpenseTotalByCategory`'s
`$group`/`$sum` aggregation, [08-expense-category-dal.md](08-expense-category-dal.md)),
not looped over in server JS — course topic: aggregation.

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

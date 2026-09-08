# 02 — Dashboard (`/dashboard`)

Status: **draft — needs Adam's approval.**

## Purpose

Show the user what they have been spending, based on the expenses saved from the
chat screen.

## What it shows

To be confirmed by Adam. The candidates, smallest first:

| # | Statistic | Notes |
|---|---|---|
| 1 | Total spent in the selected period | The basic number |
| 2 | Breakdown by category | The most useful view; a list or a chart |
| 3 | List of recent expenses | Also proves the data is really saved |
| 4 | Comparison with the previous period | Extra, only if there is time |

Period selector: today / this week / this month.

## Cases the screen must handle

| Case | Behaviour |
|---|---|
| No expenses saved yet | An empty state, not a broken chart |
| Loading | A loading indicator |
| The request fails | An error message, with a way to retry |

## Open questions

1. Which of the four statistics above are in scope for 6 days.
2. Whether the totals are calculated by the database or in the server code.
   This is a course-topic decision, so it waits for the technology list.
3. Whether to draw charts or keep it to numbers and lists. Charts add a library
   and time.

# Test spec — lived-in cases (LV)

**Designed:** 2026-09-16. Depends on `qa/specs/env-lived-in.md` being built
first — every case below names the account it runs against.

**Why these exist separately:** each one is meaningless on a fresh account. That
is precisely why a fresh-account suite will never contain them, and why ~225
passing tests say nothing about any of it.

## Layer discipline — binding on the implementer

Every case in this file carries a **Layer** field. It is not advisory. It is part
of the case, in the same way the expected result is.

- **BROWSER (headed)** means a real Chromium window with `headless: false`, driven
  through the actual screens the way a person would — clicking the real controls,
  typing into the real composer, reading the rendered result. Adam asked for
  headed specifically, so a human can watch the suite work.
- **An API-level test is never an acceptable substitute for a BROWSER case**, even
  when the same assertion is cheaper, steadier, or less flaky there. If a browser
  case is hard to automate, that is a blocker to report — not a licence to drop a
  layer. Re-labelling a case to a cheaper layer silently changes what it proves,
  and this suite already has tests that were demoted to samples for exactly that.
- **SPLIT** means both halves are required. Delivering only the cheap half leaves
  the case unimplemented, however green it looks.
- **API** is stated only where the case is deliberately reaching past the UI, or
  where the assertion is purely about a response body and the screen adds nothing
  to the risk being covered.
- **DATA SWEEP** is a direct query over the whole collection, not a request.

**Default:** if a journey has a built screen, the case goes through that screen.
Where a layer looks wrong to the implementer, raise it with Adam and change the
spec — do not resolve it at implementation time.

**Standing rules C1–C5** from `qa/specs/flow-fresh-2026-09-16.md` apply here too.

**Provenance:** all **A** (archetype-derived) unless marked otherwise.

---

## Group 1 — consistency over time (A3, A2)

Drift here is silent and corrodes every number on the dashboard.

### LV-01 — The 41st coffee lands where the previous 40 did

- **Layer:** **SPLIT — API + BROWSER (headed).** Four of the five runs at API level; **the fifth through the real chat screen.**
- **Account:** `lv_coffee` (40 near-identical coffee entries, Food › Coffee).
- **Proves:** categorisation does not drift as history accumulates. A user who
  has filed 40 coffees under one category and finds the 41st somewhere else has
  a dashboard that is quietly wrong.
- **Method:** send `bought a coffee for 19` through the real `POST /chat/messages`
  and confirm. Repeat **5 times** with 5 differently-worded but equivalent
  messages (`coffee 19`, `spent 19 on coffee`, `19 at the coffee place`,
  `grabbed a coffee, 19`, `coffee — 19`).
- **Expect:** all 5 stored `category` values equal the same ObjectId the previous
  40 use. **All five must agree** — one agreement is a coincidence.
- **Also assert (C1):** amount exactly 19, date today, a non-empty label.

### LV-02 — Behaviour does not degrade with history

- **Layer:** **SPLIT — API + BROWSER (headed).** The 20 comparison calls at API level; **one message per account** also through the screen.
- **Accounts:** a fresh signup **and** `lv_steady` (180 expenses).
- **Proves:** the thing a fresh-account suite structurally cannot see — a
  behaviour that is correct at 5 rows and wrong at 180. The model is handed the
  account's categories and recent expenses on every call, so its input genuinely
  differs between the two.
- **Method:** send the same 10 canonical messages to both accounts, confirm each.
- **Expect:** for each message, the category **name** chosen is the same on both
  accounts, and every amount and date matches the message.

### LV-03 — A plain expense still works at volume

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Method:** `spent 50 at the supermarket` → Confirm.
- **Expect:** amount 50, date today at UTC midnight, category owned by
  `lv_steady`, label non-empty. Expense count goes 180 → 181, and the other 180
  are untouched.

---

## Group 2 — near-duplicates (A5)

With 3 near-identical rows, "find the right one" stops being free. On a fresh
account every one of these passes by luck.

### LV-04 — An ambiguous edit asks before it writes

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector` (four `parking` entries in three weeks, ₪20 / ₪20 /
  ₪30 / ₪20).
- **Proves:** `docs/specs/01-ai-chat.md` §6 — *"Several matches — show them as a
  numbered list, ask the user to pick one first"*. And that picking is not
  confirming.
- **Method:** `change the parking from last week to 35`.
- **Expect:** the app returns **several matches** and writes nothing yet. Select
  one, confirm.
- **Then assert:** the **selected** row's amount is 35; the other three parking
  rows are byte-identical to before, including `updatedAt`.

### LV-05 — An ambiguous delete removes exactly the chosen row

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector` (five `supermarket` entries in a fortnight).
- **Method:** `delete the supermarket expense` → several matches → pick the
  third → confirm.
- **Expect:** exactly one row gone, and it is the third. Count down by exactly
  one. The other four unchanged.

### LV-06 — An unmatched reference says so

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector`.
- **Method:** `delete the helicopter expense`.
- **Expect:** *"nothing matched"*, nothing to confirm, zero writes.

### LV-07 — Selecting a match is not confirming it

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector`.
- **Method:** trigger a multi-match edit, select one, then **cancel**.
- **Expect:** zero writes. Every candidate row byte-identical.

---

## Group 3 — ambiguity that only exists with history (A4)

### LV-08 — A message matching three near-duplicate categories does not guess

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_sprawl` (`Groceries` / `Supermarket` / `Food shopping`).
- **Method:** `spent 200 at the supermarket`.
- **Expect:** the app either asks which category, or names the one it chose
  clearly enough that the user can correct it before confirming. It must not
  silently pick one and file it.
- **Assert:** whatever is stored, its category is the one the card named.

### LV-09 — A new category that nearly matches an existing one

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_sprawl`.
- **Method:** `add a category called Grocery under Food` — against an existing
  `Groceries`.
- **Expect:** the near-match is surfaced. If a new category is created, it is
  because the user confirmed that specifically.
- **Assert:** category count changes by 0 or 1, never more; no duplicate name
  under the same parent (`docs/specs/01-ai-chat.md` §6).

### LV-10 — Category depth stays at two with 32 categories present

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_sprawl`.
- **Method:** attempt to create a third level under an existing subcategory.
- **Expect:** refused in the reply. Nothing changes.

---

## Group 4 — the interface at volume (A2)

What the screens do when the data behind them is real. Never exercised.

### LV-11 — The dashboard equals the ledger across 180 expenses

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Proves:** I8 at a volume where an off-by-one in a date boundary or a rollup
  actually shows up.
- **Method:** for **each** of the five range selectors (today, this week, this
  month, a past month, a custom range spanning a month boundary), compare the
  screen against a direct database query for the same range.
- **Expect:** total, expense count, categories-used, every category row and % share,
  every drill-down subcategory row — all equal.
- **Boundaries specifically:** an expense dated on the first day of the range and
  one on the last day are both included exactly once.

### LV-12 — Percentages and rollups are internally consistent

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`, then `lv_sprawl` (32 categories).
- **Expect:** main-category % shares sum to 100 (±0.01 for rounding); every main
  category's rolled-up total equals its own total plus all its children's; a main
  category with no direct expenses but with spending children still appears —
  per `docs/specs/02-dashboard.md`.

### LV-13 — The recent-expenses list is honest about truncation

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Method:** view the recent-expenses table with 180 expenses in range.
- **Expect:** the rows shown are genuinely the newest by date; and **if the list
  is cut off, the user can tell.** A silently truncated list that looks complete
  is the failure mode.

### LV-14 — Chat history at 240 messages

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Proves:** `docs/specs/01-ai-chat.md` §6 — *"the last 50 messages ... oldest
  first. No pagination — a flat, fixed limit."*
- **Expect:** exactly 50 messages, they are genuinely the newest 50, rendered
  oldest-first, and the user can tell that earlier messages exist rather than
  believing this is their whole history.

### LV-15 — The screens stay usable at volume

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`, `lv_sprawl`.
- **Method:** load `/dashboard` and `/home`; expand every category.
- **Expect:** no horizontal page scroll at phone width; the dashboard renders
  within a stated budget (suggest 2 s); nothing overlaps or is clipped. This is a
  judgement case — record a screenshot in the report.

---

## Group 5 — the returner (A6)

### LV-16 — A 21-day-old conversation does not contaminate a new message

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector` (last message 21 days old, ending mid-exchange).
- **Proves:** conversation memory helps within a turn (the bare-word `18` case)
  but must not carry stale context across weeks.
- **Method:** send `spent 40 on petrol`.
- **Expect:** parsed on its own merits. It does not inherit the amount, category
  or store from the stale exchange, and does not resume a three-week-old draft.

### LV-17 — A stale pending draft is not silently confirmable

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_corrector`, with a draft left pending 21 days ago.
- **Expect:** the user is not offered a Confirm button for a draft they no longer
  remember creating. Either it is reoffered with full context, or the transcript
  records that it lapsed.

---

## Group 6 — accumulated invariants (I3, I4, I10)

Checked across the whole history, not the row just written. These are cheap and
run at the end of every lived-in run.

### LV-18 — Sweep: no expense is under a category its owner does not own · *I4*

- **Layer:** **SPLIT — BROWSER (headed) + DATA SWEEP.** Both halves required.
- **Browser half:** on `/dashboard`, every category named in the breakdown and in
  the recent-expenses table is one of this account's own categories. A person
  seeing a category they never created is the real-world symptom.
- **Data sweep half:** the same check over **every** expense, by query.
- **Why both:** the recent list renders `slice(0, 10)` — ten rows of 180. A foreign
  category on row 11 or on a category with no spend is invisible on screen. The
  browser half **cannot** replace the sweep and must not be counted as if it does.
- **Method:** across all four accounts, for every expense, assert its `category`
  resolves to a Category row whose `owner` equals that expense's `user`.
- **Expect:** zero exceptions. A single violation is a data-integrity incident.

### LV-19 — Sweep: dates are all plausible · *I3*

- **Layer:** **SPLIT — BROWSER (headed) + DATA SWEEP.** Both halves required.
- **Browser half:** on `/dashboard`, no visible row is dated in the future or
  before the account existed, and every visible date falls inside the range named
  in the header, for all five range selectors.
- **Data sweep half:** the same check over **every** expense, plus that each date
  sits at UTC midnight — a thing the screen never shows.
- **Why both:** only 10 rows are rendered, and the time component is not displayed
  at all.
- **Expect:** every expense's `date` is at UTC midnight, is not in the future,
  and is not before its owner's `createdAt`.

### LV-20 — Sweep: every expense has a label · *I10*

- **Layer:** **SPLIT — BROWSER (headed) + DATA SWEEP.** Both halves required.
- **Browser half:** no row in the recent-expenses table has an empty STORE cell.
  This is the one a human notices first — a ₪40 line with nothing written on it,
  which is exactly how this defect was found by hand on 2026-09-16.
- **Data sweep half:** no expense anywhere has both `store` and `description`
  empty.
- **Why both:** the blank row that gets found is the visible one; the blank rows
  that corrupt the ledger are the other 170.
- **Expect:** no expense has both `store` and `description` empty, across every
  account, including rows written by the cases in this run.
- **Note:** this is the accumulated form of FR-13, which already fails on live
  data.

### LV-21 — Sweep: no impossible amounts

- **Layer:** **SPLIT — BROWSER (headed) + DATA SWEEP.** Both halves required.
- **Browser half:** no amount rendered anywhere on the dashboard — recent rows,
  category totals, subcategory totals, the headline total — is zero, negative, or
  shows more than two decimal places.
- **Data sweep half:** the same over **every** stored amount.
- **Why both:** the screen rounds for display, so a stored value of `12.345` can
  render as a perfectly innocent `12.35`. The browser half genuinely cannot see
  this class; only the query can.
- **Expect:** every `amount` is > 0 and has at most two decimal places.

### LV-22 — Sweep: the ledger and the dashboard never disagree · *I8*

- **Layer:** **SPLIT — BROWSER (headed) + DATA SWEEP.** Both halves required.
- **Browser half:** the dashboard must agree **with itself**. The headline total
  equals the sum of the category rows on screen; each main category's total equals
  its own plus its subcategories'; the "expenses" and "categories used" tiles match
  what is displayed. A user comparing the big number against the list below it is
  making exactly this check.
- **Data sweep half:** the headline total equals the sum of **every** stored
  expense in that range, to the agora.
- **Why both:** the screen can be perfectly self-consistent and still be built from
  a query that dropped rows. Internal consistency is necessary, not sufficient.
- **Method:** for each account, sum every stored expense and compare against
  `GET /expenses/summary` over an all-encompassing range.
- **Expect:** equal to the cent.

---

## Traceability

Every test file implementing these cites its LV- ids in each `describe`/`it`
title.

---

# Addendum — 2026-09-16, second pass

Closing the standard areas at volume, and applying the input-diversity decision
in `qa/specs/env-lived-in.md` §2a.

### LV-23 — Forty genuinely different sentences through the real AI · *A*

- **Layer:** **SPLIT — API + BROWSER (headed).** 35 sentences at API level; **five through the real chat screen**, chosen from different cells of the corpus table.
- **Account:** `lv_steady`.
- **Proves:** the point Adam made — a history of 180 rows that were never
  *sentences* tests nothing by itself. This is the case that actually exercises
  the breadth of natural language the app claims to accept.
- **Method:** send the **40-sentence driven set** (`env-lived-in.md` §2a) through
  the real model, one per turn, confirming each valid one.
- **Expect, per sentence:** the stored amount equals the amount in the sentence;
  the stored date follows the sentence's date rule; the category is real and owned
  by this account; the label is non-empty. Sentences carrying two or three
  expenses produce that many rows.
- **Reporting:** the run report lists all 40 with pass/fail **per sentence**, so a
  weak area of the language space is visible rather than hidden behind one
  aggregate result.

### LV-24 — Response budget at volume · *A, PROPOSED*

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady` (180 expenses), `lv_sprawl` (32 categories).
- **Proves:** the budget in `flow-fresh-2026-09-16.md` Group 9 still holds when
  the data is real. This is where a missing database index shows up.
- **Expect:** dashboard renders within **2 s** with 180 expenses across all five
  range selectors; chat history of 240 messages loads within **2 s**; a chat reply
  still arrives within **10 s** despite the larger context sent to the model.
- **Report the measured numbers every run**, so drift is visible while passing.
- **Supersedes** the vague timing half of LV-15; LV-15 keeps the layout half.

### LV-25 — Log out, log back in, carry on — at volume · *E*

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Method:** save an expense; log out; log back in; save another; open the
  dashboard.
- **Expect:** the newest 50 messages return in order; both new expenses are stored
  and correct; the dashboard totals all 182. Nothing from the 180-row history is
  altered or lost by the session change.

### LV-26 — Nonsense and injection do not get easier with history · *A, I1, I5*

- **Layer:** **SPLIT — API + BROWSER (headed).** API for the payload set; **at least one** typed into the real chat screen.
- **Account:** `lv_sprawl` (32 categories to hide amongst).
- **Proves:** an injection attempt is more dangerous on an account with real data,
  because there is something to leak and something to corrupt.
- **Method:** the XS-07 set, plus `delete all my expenses` and
  `move everything to Other`.
- **Expect:** zero unconfirmed writes; all 150 expenses still present and
  unaltered; no other account's data in any reply. A genuinely destructive
  instruction still requires the normal confirmation.

### LV-27 — Leaving mid-draft at volume · *E*

- **Layer:** **BROWSER (headed).** Must be driven through the real UI in a headed Chromium. No API-level substitute.
- **Account:** `lv_steady`.
- **Method:** produce a draft, go to the dashboard, come back; then repeat with a
  reload; then repeat with a log-out and log-in.
- **Expect:** the same standard as FR-19 / FR-32 / FR-34 — the draft returns, or
  the transcript says it lapsed. Never an unanswerable question. Nothing written
  along the way.

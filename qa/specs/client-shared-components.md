# Test spec — the three extracted shared components

**Area:** `client/src/components/ChatScreen.tsx`, `DashboardTotals.tsx`,
`CategoryBreakdown.tsx`, `client/src/lib/dashboardFormat.ts`.
**IDs:** `SC-01` … `SC-16`.
**Level:** component (Vitest + RTL) unless a case says otherwise.
**Environment:** none — these are presentational, take no Redux and no
network. `SC-15` is the one browser case and uses **lived-in**.

---

## 1. Is "the caller tests still pass" sufficient evidence?

The question this round was asked to answer. `HomePage.test.tsx` and
`DashboardPage.test.tsx` were left unedited through the extraction and still
pass, 108/108 across the client suite.

**It is real evidence and it is not sufficient.** Five specific gaps, each of
which is a case below:

1. **They test the callers, not the components.** Every assertion runs through
   `HomePage` or `DashboardPage`. They prove the *composition* still produces
   what it produced before — which is exactly what a refactor should preserve,
   and exactly why passing tells you nothing new about the extracted units.

2. **They exercise one caller each. The extraction created a second.**
   `ChatScreen` now has props that exist *only* for the tutorial —
   `readOnly`, `isSending`, `isConfirming`, and `inputValue` supplied as an
   external controlled value. `HomePage` never passes them, so **no test in
   the repository exercises them at all.** The same holds for
   `CategoryBreakdown`'s `openGroups` being forced open by the caller with a
   no-op `onToggle`. The half of the new interface that the tutorial depends
   on is the untested half.

3. **The assertions predate the interface.** They were written against the old
   monolithic `HomePage`, passed before the extraction, and pass after. A test
   that passes on both sides of a change constrains only the behaviour it
   already named. Nobody chose that set with two callers in mind, because there
   was one caller when it was chosen.

4. **A new shared module arrived with no test.** `lib/dashboardFormat.ts` is
   new code, is described in the testable-surface file as "the **only** shared
   money formatter", and has no test of its own. §2 below shows that
   description is false.

5. **Passing proves no regression in the covered paths; it cannot bound the
   uncovered ones.** Nobody has measured what `HomePage.test.tsx` covers of
   `ChatScreen`. Until someone does, "the tests still pass" is a statement
   about a set of unknown size.

**What it *is* good evidence for:** that the extraction did not break the real
chat's pending-intent rendering, its confirm/cancel wiring, or its `isSaneText`
fallbacks. That is worth having and none of it should be re-derived.

---

## 2. The defect this judgement found

**There are two money formatters, and they disagree.**

```
client/src/lib/dashboardFormat.ts:4
  money = (amount) => '₪ ' + amount.toLocaleString('en-US',
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 })

client/src/components/ChatScreen.tsx:12
  const money = (amount) => `₪${amount.toFixed(2)}`
```

Different in two ways: the space after `₪`, and thousands separators. The same
expense renders as **`₪1234.50`** in the chat's confirm card and
**`₪ 1,234.50`** on the dashboard. Visible today at small values too — the
confirm card shows `₪50.00`, the dashboard row shows `₪ 50.00`.

This is the seam class exactly: two components, each internally consistent,
each passing its own caller's tests, disagreeing with each other about a shared
concept. No amount of varying the user's input finds it, because the input was
fine. Reading both declarations side by side finds it in seconds, needs no live
model, and catches it the moment it is written.

Both files are `client/` — Claude's, so this is fixable without touching
Adam's server.

---

## 3. Contract cases — cheap, deterministic, no model

### SC-01 — one money formatter, used everywhere money is printed
- **Purpose:** the defect in §2.
- **Under test:** every module that renders a currency amount.
- **Method:** static. Grep `client/src` for a currency-formatting expression
  (`₪`, `toFixed`, `toLocaleString`) outside `lib/dashboardFormat.ts`.
- **Expected:** no matches. Every file printing money imports `money` from
  `lib/dashboardFormat`.
- **Status:** **expected to FAIL** — `ChatScreen.tsx:12`.

### SC-02 — the chat and the dashboard print the same amount identically
- **Purpose:** the same defect from the user's side, so the case survives a
  refactor that moves the duplication rather than removing it.
- **Method:** render `ChatScreen` with a `create-expense` draft of `1234.5`,
  and `CategoryBreakdown` with a group of `1234.5`. Extract the currency
  strings from both.
- **Expected:** byte-identical.
- **Status:** **expected to FAIL** — `₪1234.50` vs `₪ 1,234.50`.

### SC-03 — `money()` at the boundaries
- **Purpose:** the new shared module, untested.
- **Method:** `money()` over `0`, `0.005`, `0.014`, `1`, `999.999`, `1000`,
  `1234567.891`, `-1`.
- **Expected:** exactly two decimal places in every case; the thousands
  separator appears at and above 1000 and not below; `0` renders as a zero
  amount and not an empty string; rounding is half-up and consistent —
  `0.005` and `0.014` must not both round to the same value.
- **Note:** `-1` has no product meaning (`expenseModel` enforces `min: 0.01`)
  but the function is reachable with it. Assert whatever it does, so a later
  change to it is visible.

### SC-04 — the tutorial's scripted props satisfy the real types
- **Purpose:** §4 of `docs/specs/12-how-to-use.md` argues the tutorial cannot
  drift from the app because it renders the app's own components. That argument
  holds for the *markup*; nothing checks that the *data* the tutorial hands
  those components is a shape the app could ever produce. A hand-written
  literal that drifts from the real shape shows the reader something the
  product can never do, silently.
- **Method:** static + runtime. For each of the four literals in
  `HowToUsePage` (`recordExpensePending`, `editExpensePending`,
  `createCategoryPending`, `dashboardGroups`), assert every required field of
  the corresponding real type is present and correctly typed, and that no
  field is present that the real type does not declare.
- **Expected:** all four conform.
- **Why it earns its place:** this is the one case that keeps §4's central
  claim honest as the API shapes move.

### SC-05 — `ChatScreen` renders every `PendingAction` variant
- **Purpose:** `PendingAction` is a seven-member union. `HomePage.test.tsx`
  covers `create-expense`, `edit-expense`, `delete-expense` and
  `reset-categories`. `create-category`, `edit-category` and `delete-category`
  are exercised by no test and two of them by no caller yet.
- **Method:** render `ChatScreen` once per variant, with a minimal valid
  value.
- **Expected:** each renders without throwing, produces a non-empty
  description of what will change, and shows a Confirm control exactly when
  `isReadyToConfirm` is true.

---

## 4. The props only the tutorial uses

### SC-06 — `readOnly` disables input and submission
- **Method:** render `ChatScreen` with `readOnly`. Attempt to type into the
  composer and to click Send.
- **Expected:** the input reports `readOnly`, Send reports `disabled`, the
  value does not change, and neither `onSubmit` nor `onChange` fires.

### SC-07 — `readOnly` does not remove the controls from the tab order, and that is wrong
- **Purpose:** pairs with `HT-20`. `readOnly` is the right choice for safety
  and the wrong choice for focus.
- **Method:** render `ChatScreen` with `readOnly` inside a container marked
  `aria-hidden="true"` (how `TutorialLesson` uses it). Enumerate focusable
  descendants.
- **Expected:** none.
- **Status:** **expected to FAIL** — a `readOnly` input keeps `tabIndex 0`.
  The fix belongs in `ChatScreen` (`tabIndex={-1}` when `readOnly`), not in
  `TutorialLesson`, because every future caller inherits it.

### SC-08 — `isSending` and `isConfirming` are reflected, and are mutually exclusive
- **Method:** render with each flag alone, with both, and with neither.
- **Expected:** `isSending` shows the sending affordance on Send;
  `isConfirming` shows it on Confirm; neither shows the resting state.
  **Proposed:** both-at-once is not a state the real chat can reach, so assert
  it does not render two simultaneous busy indicators.
- **⚠ The both-at-once expectation is my proposal** — no spec names it. If Adam
  would rather leave it undefined, drop that clause and keep the rest.

### SC-09 — `inputValue` is honoured as an external controlled value
- **Purpose:** the tutorial drives the composer's text from outside, which
  `HomePage` never does.
- **Method:** render with `inputValue="spent 50"`, then re-render with
  `inputValue="spent 50 at the"`.
- **Expected:** the field shows each value in turn; no internal state shadows
  the prop.

### SC-10 — the empty state is suppressible
- **Purpose:** the copy leak behind `HT-22`. `ChatScreen`'s empty state
  ("Nothing here yet. Try 'spent 50 at the supermarket.'") is correct for the
  real chat and wrong inside a lesson about editing.
- **Method:** render `ChatScreen` with no messages and an explicit empty-state
  override (or with the empty state opted out).
- **Expected:** the default copy appears when nothing is supplied, and the
  supplied copy replaces it when it is.
- **Status:** **expected to FAIL — the prop does not exist.** This case is the
  design proposal: the fix for `HT-22` belongs here, as an optional prop on the
  shared component, not as a second empty-state implementation in the tutorial.
  Adam to approve the shape before `qa-tester` writes it.

### SC-11 — `CategoryBreakdown` with a caller-forced `openGroups` and a no-op `onToggle`
- **Purpose:** how lessons 3 and 4 use it; `DashboardPage` always owns the
  state itself.
- **Method:** render with `openGroups={{ home: true }}` and
  `onToggle={() => {}}`. Assert the group renders expanded. Click its toggle.
- **Expected:** it stays expanded — the component does not keep private state
  that diverges from the prop.

---

## 5. Both callers, same component

### SC-12 — `ChatScreen` renders identically from both callers for the same data
- **Purpose:** the core claim of the extraction, asserted rather than assumed.
- **Method:** render `HomePage` with a mocked store holding exactly the
  messages and pending action from lesson 1's script. Separately render
  `HowToUsePage`'s lesson 1 at its draft-card frame. Normalise away ids and
  React-generated attributes, then compare the two subtrees' HTML.
- **Expected:** identical.
- **Note to implementer:** if they differ, report the diff and stop — do not
  loosen the normalisation until it passes. A difference here is the finding.

### SC-13 — the real dashboard is unchanged by the extraction
- **Purpose:** the testable-surface file's own words: `index.css` gained
  `.dashboard-vars` alongside `.dashboard-page`, and "the real dashboard is
  meant to look unchanged — that claim is worth checking, not assuming."
- **Method:** render `DashboardPage` against fixed data. Assert the computed
  font-family, colour and font-size of: the total figure, a category row's
  amount, and the table's amount cells — the three places the serif/gold
  tokens apply.
- **Expected:** they resolve to the same tokens `DashboardPage` used before
  `.dashboard-vars` existed. Capture the values from the current build and
  pin them.

### SC-14 — `.dashboard-vars` does not leak page layout into a lesson
- **Method:** render lesson 4's final frame. Assert the embedded dashboard
  block does not carry the full-page layout properties (page padding, min
  height, grid columns) that `.dashboard-page` sets.
- **Expected:** tokens inherited, layout not.

### SC-15 — the shared components hold up at real volume
- **Purpose:** every case above uses two or three rows. `CategoryBreakdown` on
  `lv_sprawl` has 32 categories with three near-duplicate clusters.
- **Method:** browser, logged in as `lv_sprawl`, `/dashboard` at 1440 px and
  375 px, every group expanded.
- **Expected:** every category name is fully visible or explicitly truncated
  with an ellipsis — never silently cut. Every amount cell's right edge is
  within the viewport (see `HT-16`(b) for why the document-level check is not
  enough). Percentages sum to 100 ± 1.
- **Environment:** **lived-in** (`lv_sprawl`).

### SC-16 — a regression in a shared component is visible in both places at once
- **Purpose:** the risk the whole extraction created, stated as a case so it
  is not left as a warning in prose.
- **Method:** a guard test. For each of the three components, assert the set
  of modules importing it. Fail if the set changes without this spec changing.
- **Expected:** `ChatScreen` → `HomePage`, `HowToUsePage`.
  `DashboardTotals`, `CategoryBreakdown` → `DashboardPage`, `HowToUsePage`.
- **Why:** cheap, and it makes the two-caller fact impossible to forget. The
  next person to add a third caller is told by a failing test that two other
  screens now depend on their change.

---

## 6. What this spec does not cover

- **Visual regression.** `SC-13` pins three computed values; it is not a
  pixel baseline. The 2026-09-17 findings already list "nothing clipped, no
  layout collapse" as blocked on visual-diff baselines that do not exist.
  **Accepted today:** a baseline harness is a larger piece of work than this
  round, and `SC-13` plus `HT-16` catch the two failure modes that have
  actually occurred.
- **`ChatScreen`'s `isSaneText` fallbacks.** Covered already by
  `HomePage.test.tsx`'s two cases; not re-derived here. **Accepted:** they are
  caller-level tests of component behaviour, which is the weakness named in
  §1, but they are the one place where the existing coverage genuinely does
  exercise the component's own logic.
- **`DashboardTotals` at zero expenses.** **Missed.** I did not design it. The
  empty-account dashboard is a state a real user sees on their first evening
  and no case here or in `HT-*` renders it.

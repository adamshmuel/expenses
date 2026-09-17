# User model, archetypes and flows — 2026-09-16

Written immediately after `qa/field-notes-2026-09-16-exploratory.md`, from what I
saw at the keyboard. Specs were read **after** sections 1–4 below were written;
bug records after section 5. Provenance is marked on every row so you can see how
much came from use and how much from reading.

---

## 1. The four questions

### What is this app for?

*"I want to know where my money went, without filling in a form — I just say what
I spent and it keeps the record straight."*

The product is a **truthful ledger with a conversational front door**. The chat is
the input method; the ledger is the product. If the ledger is wrong, a delightful
chat is worthless.

### How is it meant to be used?

The intended path: type what you spent in your own words → the app tells you how it
read it → you approve → it appears on the dashboard.

The promises nobody wrote down, which the screens make just by being what they are:

| Promise | Made by |
|---|---|
| "Done" means it is in the ledger. | Any confirmation message |
| Nothing is written until I say yes. | The Confirm/Cancel card existing at all |
| What I confirm is what gets stored — every field. | The card being itemised |
| Enter sends. | It being a chat composer |
| It remembers what it just asked me. | Asking me a question |
| "Yes" means yes. | It asking a yes/no question |
| The transcript is a record I can scroll back through. | It being a transcript |
| What I just recorded is on the dashboard. | The dashboard existing |
| The dashboard's total equals my expenses. | It being called "Total spent" |
| Reloading does not lose my place or my session. | It being a web page |
| The same kind of expense is filed the same way each time. | It having categories at all |

Most of what I found in the exploratory session is a breach of one of these, not a
breach of a spec. That is the point of listing them.

### How *can* it be used?

Everything actually possible, intended or not:

- Answer with a bare word (`18`), or a bare number with no units.
- Correct yourself after the draft exists — amount, store, category, date, or all four.
- Say "yes" in prose instead of clicking Confirm. Say "no". Say "sure". Say nothing.
- Abandon a draft and start a different one.
- Reload, close the tab, come back tomorrow, open a second tab.
- Send two messages before the first replies.
- Double-click Confirm.
- Write in Hebrew, or mix Hebrew and English.
- Give a relative date ("last Tuesday"), an ambiguous one, or a future one.
- Give a negative amount, a zero, a huge number, many decimals.
- Ask a question instead of recording an expense.
- Record ten things in one sentence.
- Call `POST /chat/confirm` directly with a payload the UI would never produce —
  someone else's category id, an amount of `-5`, a date in 1970.
- Use a category name that nearly matches two existing ones.

### What must never happen?

The invariants. These are what every case ultimately serves.

| # | Invariant |
|---|---|
| I1 | Nothing is written to the ledger without an explicit confirmation for that draft. |
| I2 | The app never claims something was saved that was not saved. (And never the reverse.) |
| I3 | No expense is stored under a category, amount, store or **date** the user was not shown and did not agree to. |
| I4 | No expense is stored under a category that is not owned by that user. |
| I5 | No user can read or write another user's expenses, categories or messages. |
| I6 | No password, password hash, or refresh token ever appears in a response body. |
| I7 | No failure is silent. If the app cannot do the thing, it says so and the user can proceed. |
| I8 | The dashboard's totals equal the sum of that user's stored expenses in that range. Always. |
| I9 | A confirmation acted on twice writes one expense, not two. |
| I10 | Every stored expense carries a label the user can recognise (`store` or `description`). |

---

## 2. Archetypes

Derived from what this product is and what its own history does to it — not copied
from the skill's example table.

| # | Archetype | What their account holds | What they do today | Why they matter here |
|---|---|---|---|---|
| A1 | **First evening** | Empty. 17 seeded categories, 0 expenses, 0 messages. | Signs up, records 3–5 things, gets one wrong, looks at the dashboard. | The only archetype currently tested. |
| A2 | **Two months in** | ~180 expenses over 60 days, 17–22 categories with real weight, ~250 messages. | Adds today's coffee. Glances at the dashboard. | Every model call is handed this account's categories and recent expenses. Its history is a **test input**, not scenery. |
| A3 | **Repetitive spender** | ~40 near-identical "coffee" entries, all under Food › Coffee, spread over 8 weeks. | Adds one more coffee. | Consistency over time. The 40th must land where the 4th did. |
| A4 | **Sprawler** | 30+ categories including near-duplicates (`Groceries`, `Supermarket`, `Food shopping`; `Fuel`, `Gas`, `Petrol`). | Says "spent 200 at the supermarket" — matches three. | Ambiguity that only exists with history. |
| A5 | **Corrector** | 60+ expenses, habitually edits and deletes. | "Change that coffee from last week to 24" — vague, several candidates. | Near-duplicate resolution. Picking "the most recent one" by luck passes on a fresh account. |
| A6 | **Returner** | Two months of history, last message 3 weeks old. | Opens the app, types something with no memory of the last exchange. | Stale conversation context; a dangling draft from last time. |
| A7 | **Two-tabs / reloader** | Any volume. | Keeps the app open in two tabs; reloads often. | The refresh-rotation race (field note 11). Not a data archetype — a session-state one. |
| A8 | **Hostile / direct-API caller** | Any. Holds a valid token for account X. | Calls the API directly with account Y's ids, or payloads the UI cannot produce. | I4, I5, I6. Never reachable through the UI. |

**Only A1 exists today.** The largest account in the database has 5 expenses.

---

## 3. Flows, crossed with archetypes

Provenance: **E** = exploratory (I hit it at the keyboard), **S** = spec,
**A** = archetype-derived, **B** = bug report. Bug records were read only after
this table was complete; rows that reading *added* are marked B and listed
separately in section 5 so the split stays visible.

| Flow | What it is | Archetypes it must be run as | Prov. |
|---|---|---|---|
| F1 | Sign up → first expense → dashboard shows it | A1 | E |
| F2 | One message, several expenses, confirm all | A1, A2 | E |
| F3 | Incomplete message → app asks → bare-word answer → confirm | A1, A2 | E |
| F4 | Draft exists → user corrects it → confirm the corrected version | A1, A5 | E |
| F5 | Draft exists → user cancels → nothing written, and the user can tell | A1 | E |
| F6 | Draft exists → user says "yes"/"no" in prose rather than clicking | A1, A6 | E |
| F7 | Draft exists → reload / new tab → user can still finish or is told they cannot | A7 | E |
| F8 | Relative or absent date → user sees the resolved date **before** confirming | A1, A2 | E |
| F9 | Model returns a draft the app cannot use → user is told, and has a way forward | A1, A2 | E |
| F10 | Assistant claims a save → the claim is true | A1, A2, A3 | E |
| F11 | Dashboard range filters over real spread | A2 | E/A |
| F12 | Dashboard category breakdown and drill-down over real depth | A2, A4 | E/A |
| F13 | Hebrew / mixed-language message end to end | A1, A2 | E |
| F14 | Non-expense question → honest refusal → user is pointed somewhere useful | A1 | E |
| F15 | Log in → reload → still logged in; two tabs → both stay logged in | A7 | E |
| F16 | Same expense phrasing, 40 entries apart, lands in the same category | A3 | A |
| F17 | Edit an old, vaguely-described expense among near-duplicates | A5 | A |
| F18 | New category name that nearly matches existing ones | A4 | A |
| F19 | Delete an expense by description among near-duplicates | A5 | A |
| F20 | Returner: stale context, no memory of last exchange | A6 | A |
| F21 | Direct API call with another user's category / expense id | A8 | A/S |
| F22 | Direct API call with payloads the UI cannot produce | A8 | A/S |
| F23 | Volume in the interface — what the screens do with 180 rows | A2 | A |
| F24 | Double-confirm / duplicate submit writes one row | A1, A7 | A |

### Empty cells — flows × archetypes with nothing in them today

Every cell outside column A1 is empty. Named explicitly:

- **A2 (two months in):** F2, F3, F8, F10, F11, F12, F13, F23 — none exist.
- **A3 (repetitive):** F16 — does not exist. F10 at volume — does not exist.
- **A4 (sprawler):** F12, F18 — do not exist.
- **A5 (corrector):** F4 at volume, F17, F19 — do not exist.
- **A6 (returner):** F6, F20 — do not exist.
- **A7 (two tabs / reloader):** F7, F15, F24 — do not exist.
- **A8 (direct API):** F21, F22 — partially covered at the endpoint layer; not as flows.

---

## 4. The two environments

### Fresh-account (exists today, ~225 tests)

One signup per test, minimal data, torn down. **Correct for its layer — do not
touch it.** It owns: unit logic, endpoint contracts, validation, auth boundaries,
error shapes, single-behaviour regressions, response-shape conformance.

Its ceiling: it can only ever prove the app's first five minutes. Every test in it
that walks a journey end to end is a **sample**, not coverage.

### Lived-in (does not exist — this is the new work)

Accounts carrying one to two months of accumulated history, built once and kept.
`qa-tester` builds it; the shape below is the specification.

#### Shape

Four seeded accounts, built fresh at suite start and reused across the run:

| Account | Expenses | Span | Categories | Messages | Serves |
|---|---|---|---|---|---|
| `lv_steady` | 180 | 60 days ending yesterday | the 17 seeded + 3 user-made | 240 | A2 |
| `lv_coffee` | 120, of which **40** are near-identical coffee entries | 56 days | 17 seeded | 160 | A3 |
| `lv_sprawl` | 150 | 60 days | **32**, incl. 3 near-duplicate clusters | 200 | A4 |
| `lv_corrector` | 90, with **6 deliberate near-duplicate clusters** | 45 days | 17 seeded + 2 | 300 | A5, A6 |

#### Volumes and distribution

- **Date spread:** weekday-weighted, 2–4 expenses per day, no day empty for more
  than 3 consecutive days, none dated in the future, none before the account's
  `createdAt`. `lv_corrector`'s last message is dated **21 days ago** so it doubles
  as the A6 returner.
- **Amount distribution:** log-normal-ish, ₪8–₪450, with a handful of ₪1,200–₪4,000
  (rent, insurance) so the dashboard has a realistic long tail. Two decimal places,
  never more.
- **Category weight:** Food ~35%, Transport ~20%, Home ~20%, remainder spread. Not
  uniform — uniform data hides ranking and percentage bugs.
- **Label fields:** every seeded expense carries **exactly one** of `store` or
  `description`, in the same 2:4 ratio the app itself produces today. Seeding both,
  or neither, would make the data unlike anything the app creates.

#### Near-duplicate clusters (the point of `lv_coffee` and `lv_corrector`)

- `lv_coffee`: 40 entries, description `coffee`, amounts 12–26, all under
  Food › Coffee, spread across 56 days. Two of them share an amount exactly.
- `lv_corrector`: six clusters of 3–5 expenses each that are *deliberately*
  ambiguous under a vague reference — e.g. four `parking` entries in the last three
  weeks at ₪20/₪20/₪30/₪20.
- `lv_sprawl`: `Groceries` / `Supermarket` / `Food shopping` under Food;
  `Fuel` / `Gas` / `Petrol` under Transport; `Pharmacy` / `Chemist` under Health.

#### Seeded versus driven — the split

- **Seeded directly** (fast, cheap): all background history — expenses, categories,
  prior messages. Written with the **server's own Mongoose models**, not raw
  inserts, so schema defaults, validation and indexes apply exactly as in
  production. Every seeded row must be indistinguishable from one the app made:
  real `owner`/`user` ObjectIds for that account, real category ids owned by that
  account, `date` at UTC midnight, `createdAt` consistent with `date`.
- **Driven through the real path** (the thing under test): the message being
  parsed, the draft being confirmed, the edit being matched, the delete being
  resolved. Always the real HTTP endpoint and, for flow cases, the real UI.

#### Determinism

The model is non-deterministic and these cases assert on its behaviour. Rules:

- Assert on **structure and invariants**, not exact wording. "The stored category
  is the same id as the previous 39" is deterministic; "the reply says 'I have put
  this down'" is not.
- Consistency cases (F16) run **N=5** and assert **all 5** agree, not that one does.
- Seed data is generated from a **fixed seed** so the history is byte-identical
  between runs; only the model call varies.

---

## 5. What the bug records added — read last, used as a check

Read after everything above was written and saved:
`docs/reference/testing-reference/2026-09-16-manual-bugs-found.md` and
`2026-09-16-chat-flow-bugs.md`.

### Which of my cases would have caught them

Of the recorded escaped bugs, my flow list above already covers the great majority
by class rather than by instance — F5/F7/F9/F10 between them cover the
draft-lifecycle failures, F8 covers date resolution, F15 covers the session loss,
F24 covers duplicate writes. I found four of them independently at the keyboard
before reading the file (field notes 3, 5, 10, 11), which is the check I actually
wanted on whether the exploratory session was doing real work.

### Classes the records added that exploration had not reached

Recorded as classes, applied backwards across the whole roadmap — not as one case each:

| Class | Applies to |
|---|---|
| **C1 — After any write, assert every field the user supplied *and* every field the system derived.** Not that a row exists; that every value is right. | Every case that writes. Demotes every existing "a row was created" assertion to a sample. |
| **C2 — Assert the assistant's prose and its structured payload agree**, and that the app refuses to act when they do not. | F4, F8, F9, F10 |
| **C3 — Assert the *absence* of a write on every non-confirm path**, by count and by content. | F5, F6, F7, F9 |
| **C4 — At least one case per flow must go through the real producer**, not a hand-written payload. | Whole roadmap; see below. |
| **C5 — Assert the user can always tell which of the four draft outcomes occurred.** | F5, F7, F9 |

### What the classes demote

Applying C1 and C4 backwards over the existing ~225 tests:

- Every existing API case that posts a hand-built body to `/chat/confirm` and
  asserts 200 + a row exists is a **sample of the endpoint contract**, not coverage
  of the confirm flow. Keep them; stop counting them as flow coverage.
- Every existing case that asserts a count (`expenses.length === 2`) without
  asserting the values is a **sample**. C1 replaces it.
- `DJ-01`-style dashboard cases that assert only the total are **samples**; the
  total can be right while the breakdown, the dates and the recent-expenses table
  are all wrong.

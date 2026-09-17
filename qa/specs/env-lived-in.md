# Environment spec — the lived-in accounts

**Status:** designed, not built. `qa-lead` specifies the shape; `qa-tester`
builds it.

**Why it exists:** the largest account in the database today has **5 expenses**
(measured 2026-09-16). Every judgement anyone has made about this app is a
judgement about its first five minutes. The assistant is handed the account's
categories and recent expenses as context on every single message, so the
account's history is a **direct input to the thing under test**, not scenery
around it.

**What it does not do:** it does not replace or alter the fresh-account
environment. The ~225 existing tests are correct for their layer. Nothing in this
file touches them.

---

## 1. The accounts

Four accounts, built once at suite start, reused for the whole run, dropped at
teardown. Usernames are fixed so failures are reproducible.

| Account | Expenses | Date span | Categories | Messages | Serves archetype |
|---|---|---|---|---|---|
| `lv_steady` | 180 | 60 days, ending **yesterday** | 17 seeded + 3 user-made | 240 | A2 — two months in |
| `lv_coffee` | 120, incl. **40 near-identical coffees** | 56 days | 17 seeded | 160 | A3 — repetitive spender |
| `lv_sprawl` | 150 | 60 days | **32**, with 3 near-duplicate clusters | 200 | A4 — sprawler |
| `lv_corrector` | 90, with **6 ambiguity clusters** | 45 days | 17 seeded + 2 | 300, last one **21 days old** | A5 — corrector, A6 — returner |

Archetype definitions: `qa/flow-analysis-2026-09-16b.md` §2.

## 2. Distribution rules

These are what make the data an honest input rather than a uniform block that
hides ranking, percentage and ordering bugs.

**Dates**
- 2–4 expenses per day, weekday-weighted (Mon–Thu heavier than Fri–Sat).
- No gap longer than 3 consecutive days, so every range selector has data.
- Nothing dated in the future. Nothing dated before the account's `createdAt`.
- Stored at **UTC midnight**, matching what the app itself writes today
  (verified: `"date":"2026-09-16T00:00:00.000Z"`).
- `createdAt` must be consistent with `date` — a row dated 40 days ago must not
  have been created today.

**Amounts**
- Log-normal-ish across ₪8–₪450, plus a handful of ₪1,200–₪4,000 (rent,
  insurance) so the dashboard has a realistic long tail and the percentage
  breakdown is not flat.
- Exactly two decimal places, never more. Never ≤ 0.

**Categories**
- Weighted, not uniform: Food ~35%, Transport ~20%, Home ~20%, remainder spread.
- Every `category` is a real `_id` from the **Category** collection owned by
  **that** account. Never a name, never another account's id.

**Label fields — the important one**
- Every seeded expense carries **exactly one** of `store` or `description`, in
  roughly the **2:4** ratio the app itself produces today (measured across the
  live database: 2 rows with `store`, 4 with `description`, **0 with both**).
- Seeding both fields, or neither, would produce data the app could never have
  created, and every test built on it would be meaningless in a way that still
  passes.

## 2a. Input diversity — the sentence corpus

**Decided 2026-09-16 by Adam.** Seeding 180 rows of filler builds a history for
the model to read, but tests nothing by itself. The rows must come from sentences,
and a named subset must actually be sent through the app.

**The corpus — 180 distinct sentences.** Written once, checked in, reused. No two
the same. It must deliberately spread across:

| Dimension | Must include |
|---|---|
| Wording | `spent 50 on X`, `X, 50`, `paid 50 for X`, `50 at X`, `bought X for 50`, `X — 50` |
| Language | English, Hebrew, and mixed in one sentence |
| Date | none stated, `today`, `yesterday`, a weekday, `last week`, an explicit date |
| Count | one expense, two, and three in a single sentence |
| Detail | with a shop name, with only a description, with a stated category, with none |
| Shape | tidy sentences, lower-case fragments, typos, trailing punctuation |
| Amount | whole numbers, two decimals, a four-figure amount |

**How the corpus is used, in two different ways:**

1. **Seeding (all 180).** Each sentence is parsed by a **deterministic local
   parser written for the seeder** — not the real model — into a row, which is
   then written through the server's Mongoose models. This keeps seeding fast and
   free while guaranteeing the history looks like something a person actually
   wrote. The seeder's parser is test code; it is never claimed to be under test.
2. **Driving (a named 40).** A fixed subset of **40 sentences**, chosen to be as
   different from one another as possible — at least one from every cell of the
   table above — is sent through the **real** `POST /chat/messages` and confirmed.
   This is **LV-23**, and it is the case that actually tests the breadth of
   language the app claims to accept.

The 40 are named explicitly in the corpus file, not chosen at random per run, so a
failure is reproducible.

**Cost:** 40 real model calls per full run, on top of the ~13 the other cases use.
Seeding stays free.

## 3. Ambiguity clusters

The whole point of `lv_coffee`, `lv_sprawl` and `lv_corrector`. Without these,
the near-duplicate cases have nothing to be near-duplicate *against*.

**`lv_coffee`** — 40 expenses, description `coffee`, amounts ₪12–₪26, all under
Food › Coffee, spread over 56 days. At least two share an amount exactly, so
"the ₪18 coffee" is itself ambiguous.

**`lv_corrector`** — six clusters of 3–5 expenses each, each cluster ambiguous
under a vague natural reference. At minimum:
- four `parking` entries in the last three weeks at ₪20 / ₪20 / ₪30 / ₪20
- three `pharmacy` entries in the last month
- five `supermarket` entries in the last fortnight

**`lv_sprawl`** — 32 categories including three near-duplicate clusters:
- `Groceries` / `Supermarket` / `Food shopping`, all under Food
- `Fuel` / `Gas` / `Petrol`, all under Transport
- `Pharmacy` / `Chemist`, under Health

Category depth stays at two levels — `docs/specs/01-ai-chat.md` §6 forbids three.

## 4. Seeded versus driven — the split

**Seeded directly** — all background history: expenses, categories, prior
messages.

Written with **the server's own Mongoose models** (`backend/models/*`), not raw
collection inserts, so schema defaults, validators, hooks and indexes apply
exactly as they do in production. A raw insert can create a row the app's own
validation would reject, and every assertion built on it is then testing a
fiction.

**Driven through the real path** — the interaction under test, always:
- the message being parsed → real `POST /chat/messages`, real Gemini call
- the draft being confirmed → real `POST /chat/confirm`
- the edit being matched, the delete being resolved → real endpoints
- for flow cases, through the real UI in a real browser

At least one case per flow must originate its payload from the **real producer**
(the AI), not a hand-written body. Today every confirm test hand-builds its
payload, so nothing verifies that what the AI produces is what the save path
accepts — which is how the category-less draft reached a user.

## 5. Determinism

These cases assert on a non-deterministic model. The rules that make them stable:

- Assert on **structure and invariants**, never on exact wording. *"The stored
  category id equals the one the previous 40 used"* is deterministic. *"The reply
  says 'I have put this down'"* is not, and must never be asserted.
- Consistency cases (LV-01, LV-02) run **N = 5** and require **all 5** to agree.
  One agreement is a coincidence.
- Seed data is generated from a **fixed random seed**, so the history is
  byte-identical between runs and only the model call varies. When a case fails,
  the history is not the variable.
- Every case that drives the real model must record the raw response body in the
  run report, so a failure can be diagnosed without re-running it.

## 6. Cost

Seeding is ~540 expenses and ~900 messages across four accounts — direct model
writes, a few seconds. The real-AI traffic is only the cases' own messages:
roughly 40 model calls from LV-23's driven sentence set, plus ~15 from the other
cases (LV-01 and LV-02 run at N=5). That is the deliberate cost of the split in
§4 and §2a.

## 7. Blocker

None for the environment itself. The QA harness already spawns the server with an
overridden `MONGODB_URI` and drops the database on teardown
(`.agents/qa-project-context.md` → Environments); the lived-in accounts live in
the same isolated database and are built by the same harness.

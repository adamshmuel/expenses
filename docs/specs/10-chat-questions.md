# 10 — Asking the chat about your spending (V2)

Status: **approved** (2026-09-17).

The first feature of **V2**. V1 let the chat *change* things — create, edit,
delete, reset. V2 lets it *answer* things: "how much did I spend on Food this
month", "what did I spend at Aroma", "what were my three biggest expenses".

[08-expense-category-dal.md](08-expense-category-dal.md) deferred this
deliberately and said it would get its own spec when work started. This is that
spec.

**This file is the whole of V2.** The V1 specs were edited too, so they do not
go on saying "seven intents" — but you do not need to read them to review V2.
Every one of those edits is listed in §9. This file plus
[11](11-chat-questions-server.md) is everything.

**Who writes what** is split across two files, on purpose:

| File | Covers | Owner |
|---|---|---|
| This one | What the user sees, the AI contract, the cases | Claude drafts, Adam approves |
| [11-chat-questions-server.md](11-chat-questions-server.md) | The exact server functions to write, in build order | **Adam writes the code** |

## 1. Why this is different from every other intent

Every V1 intent **changes data**, so every V1 intent needs confirmation — two
HTTP requests, nothing saved until the user says yes
([01-ai-chat.md](01-ai-chat.md) §6).

A question changes nothing. So:

- **One request, not two.** `POST /chat/confirm` is never involved.
- **No draft, no match list, no Confirm button.**
- The reply *is* the whole feature.

This makes it the safest thing to add on top of V1: no new path into the
database, and no new way to lose a user's data.

## 2. What the user can ask

Two answer shapes. Everything below is one of them.

| Shape | Examples | What comes back |
|---|---|---|
| **total** | *"how much did I spend this month"*, *"how much on Food"*, *"how much at Aroma in June"*, *"how many expenses did I record last week"* | a sum **and** a count, over the matching expenses |
| **list** | *"what were my 3 biggest expenses"*, *"show me what I spent at Aroma"*, *"my last 5 expenses"* | up to 10 matching expenses, **newest first** unless the question asks otherwise |

Both shapes accept the same four filters, all optional: **text**, **category**,
**from**, **to**. A list also accepts **sort** and **order**.

**A category means that category and everything under it.** Asking about
**Food** includes Food › Coffee, Food › Groceries and Food › Restaurants. This
is not a nicety — expenses are filed on the *subcategory*, so matching Food
alone would answer "I found no expenses" on an account with forty coffees in
it. `/dashboard` already rolls subcategories up into their main category
([02-dashboard.md](02-dashboard.md)); the chat must give the same number for
the same period, or the two screens contradict each other.

**A list is newest first by default.** *"Show me what I spent at Aroma"* means
the ten most recent, not ten arbitrary ones out of two hundred. The user only
gets a different ordering when they ask for one — *"my 3 biggest"* sorts by
amount. The default is applied by the server, not left to the model.

That is the entire query language. It is deliberately small: one filter object,
two shapes.

### When the question is too vague, the chat asks

**The model never invents a filter.** This is the same rule V1 already applies
to amounts ([01-ai-chat.md](01-ai-chat.md) §6: *"The model never invents an
amount. If the amount is missing, the draft is incomplete and the app asks for
it."*) — extended to questions.

If the model cannot build a query it is confident is what the user meant, it
does not guess. It replies with what is missing **and one example of a question
it can answer**:

> — *how much did I spend?*
> — *Over what period? You can ask "how much did I spend this month" or "how
> much on Food since June".*

The floor, so this is testable rather than a matter of taste: **a question with
no filter at all** — no text, no category, no dates — always asks back. Above
that floor the model judges. A question that names a shop or a category but no
dates is answerable over all time, as long as the reply says that is the range
it used.

**The ask-back is in the user's language**, like every other reply. This needs
saying because the language rule in §4 binds the *second* AI call, and a vague
question never reaches it — the ask-back is written by the first call. A Hebrew
user asking a vague question in Hebrew must be asked back in Hebrew. The same
applies to the templated fallback in §4.

Asking back costs nothing: no query runs, no second AI call is made, and the
server treats it exactly like any other reply.

### The server asks back too, when a name is ambiguous

The model is not the only one that can be short of information. A user may have
**two categories with the same name** under different parents — Food › Coffee
and Home › Coffee are both legal ([04-data-model.md](04-data-model.md) forbids
duplicates only under the *same* parent). The model cannot know which was
meant; it passed a name, and only the server can see that the name matches two
rows.

So the server does what the model does: **it asks, rather than picking one.**

> *"You have two categories called Coffee — one under Food, one under Home.
> Which did you mean?"*

`answerQuestion` returns a third shape, `ambiguous`, carrying the candidates
instead of numbers. That goes into the same second AI call as any answer, which
phrases the question — so it comes back in the user's own language for free,
rather than as a flat English error. Silently picking the first match would
answer a question the user did not ask.

### Not in V2

Named here so they are decisions and not oversights:

| Not doing | Why |
|---|---|
| Comparisons — *"more than last month?"* | Two queries and a judgement. Its own feature. |
| Averages, forecasts, advice | The app is a ledger, not an advisor. |
| Questions about categories themselves — *"how many categories do I have"* | The dashboard shows this. Low value, new query path. |
| Charts or tables in the chat | The reply is prose. `/dashboard` is where you look at shapes. |
| Changing anything as a follow-up — *"...and delete the biggest one"* | The next message can say that; V1 already handles it. One intent per message. |

## 3. The flow

1. The user types a question.
2. The client sends it to `POST /chat/messages` — **the same endpoint as every
   other message.** The client does not know in advance that it is a question.
3. The server saves the user's message, then calls `backend/ai/` as it always
   does. The AI returns `intent: "answer-question"` plus a **question object**
   (§4) — **or no question object**, when it needs the user to be more
   specific. In that case its reply is the ask, steps 4 and 5 are skipped, and
   the reply is saved as it would be for any other intent.
4. The server runs that question against the user's own data using its own
   query functions ([11](11-chat-questions-server.md)). **The numbers come from
   the database, never from the model.**
5. The server sends the computed result back to `backend/ai/` for a **second**
   call, which turns the numbers into a sentence in the user's own language.
6. That sentence is saved as the assistant message and returned.

Steps 4–5 are the only place in the app where one request makes two AI calls.

**The first call's `reply` is discarded for this intent**, because the real
answer does not exist yet when it is written. Only the second call's sentence
is saved. Chat history therefore reads normally: one question, one answer.

### What the client does

**Nothing new.** The answer arrives in the existing `reply` field and renders
like any other assistant message. No client change ships with V2.

## 4. The AI contract — `backend/ai/`

Claude's code, unchanged rule: it never touches the database
([01-ai-chat.md](01-ai-chat.md) §8).

### Call one — `parseMessage`, a new eighth intent

```js
{
  intent: "answer-question",
  question: {
    shape:    "total" | "list",
    text:     "aroma",        // optional — matches store or description
    category: "Food",         // optional — a category NAME, never an id
    from:     "2026-09-01",   // optional
    to:       "2026-09-30",   // optional
    sort:     "amount",       // list only: "amount" | "date"
    order:    "desc",         // list only: "asc" | "desc"
    limit:    3               // list only, 1–10
  }
}
```

`category` is a name, exactly like `changes.category` on an edit — the server
resolves it against the category list it already passed in. Resolving a **main**
category yields that category **and all its subcategories**; the filter then
matches any of them.

**`question` is absent** when the model is asking the user to be more specific
(§2). `intent` is still `answer-question` — the model understood that a
question was asked; it just cannot answer this one yet. The server's test is
simply whether `question` is there.

### Call two — `answerQuestion`, new

Input: the user's original question, plus the **already-computed** result from
the server. Output: `{ reply: "..." }`.

When no date range was given, the result also carries the account's **earliest
expense date**, so the reply can name a real range — *"since March, across all
218 expenses"* — instead of gesturing at "all time". It comes free from the
same aggregation ([11](11-chat-questions-server.md) step 2).

Its prompt is bound by three rules:

1. **Never calculate.** Every number in the reply is one that was handed to it.
2. **Reply in the language the question was asked in.**
3. **Say which range and filters were used**, so the user can tell the app
   understood them: *"Between 1 and 30 September you spent ₪1,240 on Food,
   across 32 expenses."*
4. **Answer the question that was asked.** *"How many coffees"* is answered
   with the count, not only with the money. Both numbers are always available;
   which one leads is set by the question.
5. **For a list, say which ten these are** — the ordering, and that there are
   more. A user shown ten rows out of two hundred with no warning will read
   them as the whole answer:

   > *"These are the latest 10 expenses at Aroma. There are 46 more."*
   > *"Your 3 biggest expenses this month:"*

   Never *"here are your expenses at Aroma"* when it is a truncated slice.

If this second call fails, `backend/ai/` returns a plain templated sentence
built from the same numbers rather than an error. The user gets their answer;
it just reads flatly. A question is never a dead end. **The fallback follows
the question's language too** (§2).

### Two guards on the second call

**A reply over 2,000 characters is discarded** and the fallback used instead.
`backend/ai/` has no output-length cap today, and the run on 2026-09-16
produced a **207 KB** response on a path carrying *less* input than this one.
V2's second call receives up to ten expenses of user-controlled text on every
list question. Two thousand characters is generous for ten rows of prose and
catches a collapse early.

**Every answered question is logged**, inside `backend/ai/` where all three
pieces are already in hand: the `question` object the model built, the filters
actually used after defaults and caps, and the `{ total, count }` or row ids
that came back — plus whether the fallback fired. A wrong number has three
possible causes (wrong query, wrong execution, wrong restatement) and they
cannot be told apart afterwards without this. No token, no key, no hash.

## 5. Cases to handle

| Case | Behaviour |
|---|---|
| Nothing matched | *"I found no expenses matching that."* — **not** "you spent 0", which reads like a fact about your spending rather than an empty search |
| Named category does not exist | Say so by name: *"You don't have a category called Pets."* Never silently drop the filter and answer a different question |
| A **main** category is named — *"how much on Food"* | Includes every subcategory under it. The number must equal the dashboard's Food total for the same period |
| **Two categories share the name** — Food › Coffee and Home › Coffee | Ask which one, naming both parents. Never pick the first match |
| A word is both a category and a shop — *"how much on coffee"* | If it matches one of the user's category names, treat it as a category. Otherwise as text. State which in the reply |
| No date range, but a shop or category named | Answer over **all** the user's expenses, and say so in the reply |
| Nothing to filter on at all | Ask back, with an example (§2). No query, no second AI call |
| A list would return more than 10 | Return 10, **the latest 10**, and say so in the reply — *"These are the latest 10 expenses at Aroma. There are 46 more."* Never present a slice as the whole |
| A list the user ordered themselves — *"my 3 biggest"* | Sort by amount instead, and say **that** in the reply — *"Your 3 biggest expenses this month."* The reply always names the ordering it used |
| `spent 50 on coffee` misread as a question | The real risk of this feature: the model now chooses between eight intents, and a statement and a question about the same thing are one word apart. The prompt must draw the line explicitly, and it gets its own QA cases |
| The second AI call fails or times out | Templated fallback sentence (§4). No error shown |
| The first AI call fails | Unchanged from V1 — a `502`, the user's text is not lost |
| The user names a limit above the cap — *"show me all 50 of my coffees"* | Return 10 and say the cap applied. The user asked for a number and got a different one; saying nothing makes it look like they only have 10 |
| The model returns a nonsense `sort`, `order` or `shape` | Fall back to the spec's defaults. An unknown `shape` is refused clearly rather than guessed at |
| `limit` is 0 or negative | Treated as absent — the default 10 applies |
| A question **and** a write in one message — *"show me my 3 biggest and delete the top one"* | Answer the question, and say it can only do one thing at a time. §2's one-intent-per-message rule says what the app accepts; this says what it does when asked both |
| A question asked near midnight local time | Ranges are resolved in **UTC**, like every other date in this app ([04-data-model.md](04-data-model.md)). *"This month"* can therefore be off by a day for a user a long way from UTC. Accepted for V2, recorded rather than hidden |
| An expense's own text reaches the second call | It does, and that is accepted: a shop named to look like an instruction can only make the reply read oddly. The second call's output is prose shown to the user — it never triggers an action, and it is never given the ability to query again |

### Bars

Numbers this feature is measured against. All new; all set here rather than
inherited, because the existing bars were written for a path that makes **one**
model call and this one makes two.

| Bar | Value | Why this number |
|---|---|---|
| An answered question | **15 s** | Two model calls in sequence with a database query between them. The existing 10 s bar was set for one call; reusing it would fail honest behaviour, and dropping it would hide a path 50% slower by design |
| A vague ask-back | **10 s** | One model call, so the existing bar applies unchanged |
| Something visibly happening | **300 ms**, and a pending indicator for the **whole** wait | The longest wait in the app must not look like a hang |
| A ten-row answer at 375 / 768 / 1280 px | No horizontal page scroll, nothing clipped, the "N more" line not cut off | `LV-15` already found the dashboard overflowing at phone width. This is the same content class in a narrower container |
| A Hebrew reply's figures | Amounts, dates and `₪` not reversed, not split from their numbers | A real defect class whatever is decided about text direction |

The 15 s figure has never been measured. Every question's time is recorded in
the run report whether it passes or not, so the threshold can move to fit
reality after the first run.

**Deferred, deliberately: right-to-left rendering.** A proposed bar would have
required a reply more than half Hebrew to render with `direction: rtl`. There
is no RTL handling anywhere in `client/` today, so that is a **feature nobody
has decided to build**, not a bar the app is failing. Admitting it here would
make the suite report a missing feature as a defect on every run. It needs its
own spec.

## 6. What this earns

Honestly: **no new course topic.** Per `.claude/rules/product-first.md`, that is
not a reason to change the feature.

What it does do is deepen one Adam already has — the Mongo aggregation stops
being a single fixed dashboard breakdown and becomes a filtered `$match` with
`$sum` and `$count`, alongside `$sort`/`$limit` on the finder. That is a better
demonstration of the same topic than V1 has today.

Streams (demo 25) and Socket.io (demo 26) remain uncovered. V2 does not pretend
to cover them.

## 7. Decided

**A vague question is asked back, never guessed at.** Decided by Adam,
2026-09-17. An earlier draft had the app silently answer over all time when no
period was given; that is a confident wrong answer, and it is also out of
character — everywhere else, this app asks rather than assumes. The full rule
and its testable floor are in §2.

**A list returns the latest 10 expenses, and says so.** Decided by Adam,
2026-09-17. Two parts to it.

*At most 10* — two reasons, neither of them arbitrary:

- A chat reply listing 200 expenses is not an answer, it is a wall. The
  dashboard exists for looking at everything.
- Those expenses are sent into the **second AI call** as text. An uncapped list
  means an uncapped prompt — slower, more expensive, and the run on 2026-09-16
  already produced a 207 KB model response under exactly that kind of load
  (`docs/reference/testing-reference/2026-09-17-automated-run-findings.md`).

*The latest 10, and the user is told* — a cap is only honest if the user knows
it was applied and which ten they got. Newest-first is the default because it is
what "show me what I spent at Aroma" means; a different question gets a
different ordering, and the reply names whichever was used. See §4 rule 4.

**A main category includes its subcategories, and an ambiguous name is asked
back.** Both decided by Adam, 2026-09-17, after `qa-lead`'s design review found
that the spec as first written would have answered *"I found no expenses"* to
its own headline example. Rules in §2.

**The remaining eleven gaps `qa-lead` raised were accepted as it proposed
them**, 2026-09-17 — the language rule extended to the ask-back and the
fallback, exactly two chat messages per question turn, UTC dates accepted and
written down, nonsense values from the model falling back to defaults, and the
five bars above. The one proposal rejected was right-to-left rendering, for the
reason given in §5.

## 8. Open questions

None.

## 9. What changed in the V1 specs

So V2 can be reviewed from this file alone. Each row is an edit already made —
nothing here is a proposal.

| Spec | What changed |
|---|---|
| [00-overview.md](00-overview.md) | New "V2 — asking, not only telling" section: what V2 is, and the two-file owner split |
| [01-ai-chat.md](01-ai-chat.md) §6 | "one of seven intents" → **eight**, with `answer-question` added to the intent table |
| [01-ai-chat.md](01-ai-chat.md) §6 | The confirm rule now reads "whichever of the **seven writing** intents" — the eighth has no confirm step and no second request |
| [01-ai-chat.md](01-ai-chat.md) §7 | New case row: a statement misread as a question, or the reverse — pointing here |
| [01-ai-chat.md](01-ai-chat.md) §8 | The output table gains an `answer-question` row; the section head now says `backend/ai/` exposes **two** functions in V2, not one |
| [03-api-contract.md](03-api-contract.md) §3 | New "V2 adds no endpoint" subsection: same `POST /chat/messages`, the answer arrives in the existing `reply` field, `/chat/confirm` never involved, **no client change** |
| [08-expense-category-dal.md](08-expense-category-dal.md) scope | The "deferred, gets its own spec later" note now points here and records that `queryExpenses` was extended rather than replaced — as that spec predicted |
| [08-expense-category-dal.md](08-expense-category-dal.md) expense table | New row: `getExpenseTotals(userId, filters)` |
| [08-expense-category-dal.md](08-expense-category-dal.md) filter table | Three new rows: `category` (an `$in` over an **array** of ids, so a main category carries its subcategories), `sort`/`order`, `limit` |
| [08-expense-category-dal.md](08-expense-category-dal.md) open questions | Was "deliberately deferred" — now closed, pointing here |
| [09-expense-category-service.md](09-expense-category-service.md) §4 | New `answer-question` bullet in `POST /chat/messages`, including the reason its reply is not known at step 4 |
| [09-expense-category-service.md](09-expense-category-service.md) §4 | A line under `POST /chat/confirm` stating that `answer-question` never reaches it |

**Untouched by V2:** [02-dashboard.md](02-dashboard.md),
[04-data-model.md](04-data-model.md), [05-user-layers.md](05-user-layers.md),
[06-server-modules.md](06-server-modules.md),
[07-server-entry.md](07-server-entry.md). No schema change, no new module, no
new environment variable.

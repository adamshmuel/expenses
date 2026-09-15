# Plan for 01-ai-chat.md — `backend/ai/`

Spec: [../specs/01-ai-chat.md](../specs/01-ai-chat.md) §8. Also see
[../specs/08-expense-category-dal.md](../specs/08-expense-category-dal.md)
"`backend/ai/` and the DAL" for the exact call shape.

Scope of this plan: **`backend/ai/` only** — the self-contained folder Claude
owns ([../../.claude/rules/ownership.md](../../.claude/rules/ownership.md)).
`routes/chat.js`, which calls this module, is Adam's own code and is planned
separately once he writes it.

## What gets built

One function, `parseMessage(text, categories, recentExpenses)`, exported from
`backend/ai/index.js`.

```
parseMessage(text, categories, recentExpenses)
  → { intent, reply, ...intent-specific fields }
```

- `text` — the user's raw chat message.
- `categories` — this user's categories (from `categoryService.getForUser`),
  so the model can match a name the user typed against a real category
  without a second DB round trip.
- `recentExpenses` — last 30 days (from `expenseService.getForUser`), so the
  model has something to match "the coffee expense" or "that IKEA expense"
  against.
- Returns one of the seven shapes in spec 01 §8's table, by `intent`, plus a
  `reply` string on every response. Never touches the database — pure
  input-in, structured-data-out.

## Steps (TDD order)

1. **`backend/ai/prompt.js`** — the system prompt / instructions given to the
   model: the seven intents, the fixed output shape per intent, the "never
   invent an amount" and "date defaults to today" rules (spec 01 §6). A plain
   string/template function, no test needed — nothing to assert against
   except by calling the model, which step 3 covers.

2. **`backend/ai/schema.js`** — the fixed response shape the model must
   return, one shape per intent, matching spec 01 §8's table exactly
   (`create-expense`, `edit-expense`, `delete-expense`, `create-category`,
   `edit-category`, `delete-category`, `reset-categories`). Write this from
   the table directly — it is the contract test 3 checks parsed output
   against.

3. **`backend/ai/parseMessage.js`** — calls Gemini Flash Lite with the prompt
   + schema + `text`/`categories`/`recentExpenses`, and returns the parsed
   result. Test first: for each of the seven intents, a sample input message
   → assert the output has the right `intent` string and the right fields
   for that intent (per spec 01 §8's table). Use the ladder
   (ponytail:full) — reach for whatever the installed Gemini SDK already
   gives for structured/JSON output before hand-rolling parsing or
   validation.

4. **Failure path** — the model call throws, times out, or returns something
   that doesn't match the expected shape → `parseMessage` throws a plain
   `{ status: 502, message: "..." }` (same error shape as the rest of the
   backend, per spec 09 §6) instead of leaking a raw provider error. One test:
   force a failure (mock the SDK call rejecting) → assert the 502 shape.

5. **`backend/ai/index.js`** — exports `{ parseMessage }`. This is the only
   thing outside `backend/ai/` ever imports.

6. **`.env` key** — `GEMINI_API_KEY` (or whatever the installed SDK expects),
   read via `dotenv` (already a backend dependency). Add the key name to
   `backend/.env.example` — no real key committed. This touches a file
   outside `backend/ai/`, but `.env.example` is not `backend/` application
   code (no route/service/model lives there), so it is not covered by the
   ownership hook's restriction the way `backend/` source files are; flag it
   to Adam when it happens rather than assuming.

## Dependencies to add

No Gemini SDK is installed yet (`backend/package.json` has no Google/Gemini
package). Step 3 adds exactly one dependency for the model call itself —
nothing else. Ladder rung 5: reach for it, do not hand-write an HTTP client
against the Gemini REST API when an official SDK exists.

## Out of scope for this plan

- `routes/chat.js` (Adam's code, planned separately once he writes it).
- Resolving a category **name** to a real category document/id —
  `expenseService.resolveCategory` (spec 09 §3) does that, after
  `parseMessage` returns. `backend/ai/` only ever emits a name string.
- Running `searchFilters` as an actual query — the route/service layer's job
  (spec 09 §4).
- The "answer a question about past spending" intent — deferred to v2, per
  spec 08's "Scope" section.

## Course-topic note

This plan covers spec 01 §9's "Node.js — Adam's side" row for CORS/dotenv
only incidentally (the `.env` key). Every other course-topic row in that
table belongs to `routes/chat.js`, not this module — `backend/ai/` itself
demonstrates no course topic on its own; it is plain Node/JS calling an
external API, per [../../.claude/rules/product-first.md](../../.claude/rules/product-first.md):
built because the product needs it, not to tick a topic.

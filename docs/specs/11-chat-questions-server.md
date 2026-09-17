# 11 — V2 server build sheet (Adam)

Status: **approved** (2026-09-17).

Everything **you** write for V2, in build order. The feature itself is
[10-chat-questions.md](10-chat-questions.md); this file is only the work.

Four steps, three files, roughly **60 lines**. Each step works on its own — you
can stop after any of them and the app still runs.

---

## Step 1 — `dal/expenseRepository.js` · extend `queryExpenses`

**~8 lines.** The finder already handles `from`, `to`, `text`. Add three keys.

| New key | Does |
|---|---|
| `category` | an **array** of category ids — `$in`, because a main category carries its subcategories with it |
| `sort` + `order` | `.sort()` on `amount` or `date`, `asc` or `desc` |
| `limit` | `.limit()`, never above 10 |

`Expense.find(...)` returns a query you can keep chaining onto before it is
awaited, so this is added on the end — the existing filter-building code does
not change.

**Check:** the dashboard still lists expenses. You changed a function it uses.

---

## Step 2 — `dal/expenseRepository.js` · new `getExpenseTotals`

**~25 lines.** A second aggregation, next to `getExpenseTotalByCategory`.

```js
getExpenseTotals(userId, filters) → { total: Number, count: Number }
```

Same `filters` object as step 1 — `from`, `to`, `text`, `category`.

- `$match` — build it the same way `queryExpenses` builds its query, plus
  `user: new mongoose.Types.ObjectId(userId)` (aggregation does not cast the id
  for you; the existing `getExpenseTotalByCategory` already shows this).
- `$group` — `_id: null`, with **both** `total: { $sum: "$amount" }` and
  `count: { $sum: 1 }`. One pass over the data answers "how much" and "how
  many" together.
- Add `earliest: { $min: "$date" }` to the same `$group`. When the user gave no
  date range, the reply names a real range — *"since March"* — instead of
  saying "all time" ([10](10-chat-questions.md) §4). Same query, one more line.
- An empty result is `[]`, not a zero row. Return `{ total: 0, count: 0 }`
  yourself — the difference between "no expenses matched" and "you spent 0"
  matters to the user ([10](10-chat-questions.md) §5).

**Check:** call it with no filters for a seeded account; the total should match
the dashboard's.

---

## Step 3 — `bl/expenseService.js` · new `answerQuestion`

**~20 lines.** The only step with a rule in it.

```js
answerQuestion(userId, question) → { shape, total, count, expenses, category, from, to }
```

`question` is what the AI produced ([10](10-chat-questions.md) §4).

1. **Resolve the category name into a list of ids.** `question.category` is a
   *name*. Look it up with `categoryService.findByName`, then:
   - **not found** → throw a clear error naming it; the route turns that into
     the reply
   - **more than one match** → do not pick. Return `{ shape: "ambiguous",
     options: [...] }` with each match and its parent's name, and let the second
     AI call ask which one ([10](10-chat-questions.md) §2)
   - **one match, and it is a main category** → collect **its subcategories
     too**. Expenses are filed on the subcategory, so matching only the parent
     finds nothing. You already have the user's full category list in the route;
     the children are the ones whose `parent` is this category's id
   - **one match, and it is a subcategory** → just that id

   Either way you end up with an **array** of ids, never a single one.
2. **Fill in the defaults for a list**, here and not in the route — the AI may
   leave them out, and it is not trusted to cap anything:
   - `limit` — at most 10
   - `sort` — `date`, `order` `desc`, so a plain *"show me what I spent at
     Aroma"* returns the **latest** ten and not ten arbitrary rows
     ([10](10-chat-questions.md) §2)
3. **Branch on `shape`:**
   - `"ambiguous"` → nothing to query; return it as it is
   - `"total"` → `getExpenseTotals`
   - `"list"` → `queryExpenses`, populated with the category name. Also get the
     **full** match count, so the reply can say "there are 46 more" — the
     cheapest way is `getExpenseTotals` with the same filters, which already
     returns `count`
4. Return the result **together with the filters you actually used** — the
   reply has to tell the user which range and filters were applied, so the AI
   needs them back. For a list that includes the **ordering** and the **full
count**, not just the ten rows.

**Check:** three things.

1. Ask for a category you don't have — your own message, not a Mongoose one.
2. `how much on Food` on `lv_steady` must equal the dashboard's Food total for
   the same period. If it comes back as zero, step 1 is only matching the parent.
3. Make two categories called Coffee under different parents, then ask about
   Coffee — you should be asked which, not given a number.

---

## Step 4 — `routes/chatRoute.js` · the new case

**~10 lines**, and the only step that edits code that currently works.

Today the route saves the AI's reply with one line after the switch:

```js
const reply = await messageService.saveMessage(req.user.id, result.reply, "assistant");
```

For a question that line runs **too early** — the real answer does not exist
until after the query and the second AI call. So:

1. Put `result.reply` into a variable before the switch.
2. Add `case "answer-question":` — **if `result.question` is missing, do
   nothing.** That means the AI is asking the user to be more specific
   ([10](10-chat-questions.md) §2), and `result.reply` is already the right
   thing to save. Otherwise call `expenseService.answerQuestion`, then
   `ai.answerQuestion` (Claude will have written it), and overwrite the
   variable with the sentence it returns.
3. Save the variable instead of `result.reply`.

Every other intent behaves exactly as before, because for them the variable is
still `result.reply`.

`POST /chat/confirm` is **not touched.** A question saves nothing, so it never
reaches request two.

**Check:** three messages, in this order.

1. `spent 50 at the supermarket` — confirm V1 is undamaged and still asks you
   to confirm.
2. `how much did I spend?` — should ask you to be more specific. No query runs.
3. `how much did I spend this month?` — should answer.
4. On `lv_coffee` (125 expenses, 40 of them coffee): `show me what I spent on
   coffee` — should return 10, newest first, and the reply should say both that
   they are the latest and how many more there are.

---

## Not yours

| Piece | Who |
|---|---|
| The eighth intent in the prompt and the response schema | Claude, `backend/ai/` |
| `ai.answerQuestion` — the second call that writes the sentence | Claude, `backend/ai/` |
| The client | Nobody — the answer arrives in the existing `reply` field |
| Tests | The `qa/` suite |

## Nothing to decide first

Both open questions were closed on 2026-09-17
([10](10-chat-questions.md) §7): a vague question is asked back rather than
guessed at, and a list returns at most 10. Step 3 caps at 10; the asking-back
is handled by the AI and costs you the one `if` in step 4.

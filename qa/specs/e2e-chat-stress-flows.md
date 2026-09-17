# Test spec — chat stress flows (E2E, browser, real AI)

**Under test:** the add-an-expense flow as a real user actually drives it —
not the single happy-path walk in `e2e-chat-dashboard-journey.md`'s `FJ-01`,
but the messy, multi-turn, corrected, abandoned, and adversarial shapes named
in `qa/flow-analysis-2026-09-16.md` and drawn directly from
`docs/reference/testing-reference/2026-09-16-manual-bugs-found.md` and
`2026-09-16-chat-flow-bugs-and-fixes.md`.

**Governing spec:** `docs/specs/01-ai-chat.md` §6-§7.

**Level:** E2E — real Chromium, real Vite client, real server, real test DB
(`expenses_qa_test`), same isolation as `qa/e2e/tests/chat-dashboard-journey.spec.ts`.
Every test here makes at least one real Gemini call — kept to the minimum
number of turns each scenario actually needs. Assertions are loose on the
model's own wording (non-deterministic) and strict on stored data and
structural behaviour (a draft appears or doesn't, a row exists with the
right fields, a count doesn't change).

**Automation:** `qa/e2e/tests/chat-stress-flows.spec.ts`.

**Why these and not more single-message tests:** per
`2026-09-16-chat-flow-bugs-and-fixes.md`'s closing section ("What `qa` should
take from this"), four of the five bugs behind the broken flagship flow
needed an **incomplete or multi-turn** input to surface — a complete,
one-message, valid payload (the only shape any existing E2E or API test
sent) could not have found any of them. Each test below is built around one
of the specific incomplete/adversarial shapes those bugs identify, not a
generic fuzz.

---

### FS-01 — missing amount, answered in a follow-up turn (conversation memory, bug 8 class)
- **Method:** sign up through the UI. Send `"spent money at the supermarket"`
  (no amount stated). Wait for the assistant's reply. Send `"50"` as a
  follow-up. Wait for a Confirm button. Click it.
- **Expected:** after the first message, **no** Confirm button appears (the
  model must not invent an amount — spec §7 "Amount missing... Save nothing").
  After the follow-up, a Confirm button appears. After confirming,
  `GET /expenses` (via the browser's own session, same pattern as `FJ-01`)
  shows exactly one new expense with `amount === 50`, a real category id
  (resolved to one of this user's actual categories, fetched via
  `GET /categories` — never `null`/absent), and `date` on today's calendar
  day (bug 4 class: date, not just amount, must be right).

### FS-02 — the user corrects a draft before confirming (pushback, bug-fix-file's "ignored corrections")
- **Method:** send `"spent 30 on transport"`. Wait for a Confirm button and
  record the assistant's reply text. Before clicking Confirm, send
  `"actually make that 50"`. Wait for the Confirm button to still be present.
  Click it.
- **Expected:** the second assistant reply is **not** identical to the first
  (the exact regression named in the bug-fix file: "an identical reply to a
  pushback is the single worst failure here"). After confirming,
  `GET /expenses` shows **exactly one** new expense (not two — the
  correction must replace the draft, not add to it) with `amount === 50`
  (not 30).

### FS-03 — several expenses in one message
- **Method:** send `"I spent 20 on coffee and 15 on the bus"`. Wait for the
  confirm card. Click Confirm.
- **Expected:** the confirm card lists at least 2 draft items before
  confirming (spec §6 "several expenses... numbered list... one
  confirmation"). After confirming, `GET /expenses` shows **exactly 2** new
  expenses; the set of amounts is `{20, 15}` (order-independent); both have a
  real category id from this user's own category list and today's date.

### FS-04 — a category that doesn't exist yet is never silently saved (bug 10, first half — fixed; verifying the fix holds)
- **Method:** send `"spent 45 on a new bike"` — no category named "Bike"
  exists in the default set. Read whatever the assistant replies.
- **Expected:** **either** no Confirm button appears (the model asked
  instead, or proposed `create-category`) **or**, if a create-expense draft
  is shown, its displayed category is one of this user's *real* existing
  category names (fetched via `GET /categories`) — never the literal,
  nonexistent `"Bike"`. Whichever branch happens, this test never clicks
  Confirm — the assertion that matters is server-side: `GET /expenses`
  is still empty afterward, proving nothing was silently saved under a
  category that was never real.

### FS-05 — reloading mid-conversation loses the pending draft, keeps the history
- **Method:** send `"spent 20 on coffee"`. Wait for the Confirm button.
  Reload the page (`page.reload()`) instead of confirming.
- **Expected:** after reload, no Confirm button is present (the pending draft
  was always client-only memory, never persisted — this is expected
  behaviour, not a bug). The message thread still shows both the typed text
  and the assistant's reply (`GET /chat/messages` persisted them —
  regression guard for bug 5's fix, applied to the "abandoned, not
  confirmed" case specifically, which bug 5's own fix note did not cover).
  `GET /expenses` is empty — the abandoned draft was never saved.

### FS-06 — logging out and back in mid-conversation preserves history, not the pending draft
- **Method:** send `"spent 15 on lunch"`. Wait for the reply (do not
  confirm). Log out via the navbar. Log back in with the same credentials.
  Navigate to `/home`.
- **Expected:** the message thread still shows the earlier exchange (same
  persistence guard as FS-05, via a real session boundary instead of a
  reload). No Confirm button is present (fresh page load, no pending state
  — expected, not a bug). `GET /expenses` is empty.

### FS-07 — typing "yes" instead of clicking Confirm (bug 6, open by design — documents current behaviour, not a failure)
- **Method:** send `"spent 20 on coffee"`. Wait for the Confirm button. Do
  **not** click it. Instead, type `"yes"` into the message box and send it.
- **Expected — current, intentionally open behaviour, per
  `2026-09-16-manual-bugs-found.md` bug 6 and the task instructions for this
  run:** the original Confirm button's draft is not silently confirmed by
  typing "yes" — no new expense with `amount === 20` exists afterward
  (`GET /expenses` empty). This is asserted as the **current** behaviour to
  catch a regression in either direction, not as the desired one — Adam has
  not yet decided whether "yes" should map to confirm (see the flow-analysis
  doc). If this test starts failing because "yes" now confirms the pending
  draft, that is a **product decision having been made**, not a bug — update
  this spec and test once Adam decides, don't just re-assert the old
  behaviour.

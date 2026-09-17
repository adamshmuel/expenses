# Bugs found by the first full automated QA run

Not a testable-surface inventory like most files in this folder — this is a
record of what the first run of the redesigned QA suite found, written the
night it ran. It follows `2026-09-16-manual-bugs-found.md` and
`2026-09-16-chat-flow-bugs-and-fixes.md`, which recorded bugs found by hand.

The point of this run was to find out whether automation could catch the class
of bug that had, until now, only ever been found by a person using the app.

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `client/`, `backend/` (read-only), `backend/ai/`, via 85 designed cases | commit `e03e215` | Run 2026-09-16 23:00 → 2026-09-17 00:09. Nothing fixed as of this writing. |

**The run:** 359 tests — 309 passed, 49 failed, 1 blocked. 77 of the 85 cases
drove a real headed Chromium against a real server and a real Gemini call.

**The triage:** `qa-tester` graded the 49 failures, then `qa-lead` audited that
grading and overturned part of it. Both numbers are given below, because the
disagreement is itself a finding.

| Verdict | `qa-tester` | After `qa-lead`'s audit |
|---|---:|---:|
| Real defect in the app | 29 | **35** |
| This suite's own test bugs | 13 | 12 |
| Run artefact (model slowness) | 6 | **0** |
| Inconclusive | 1 | 2 |

---

## The eight to fix first

Ordered by damage to the user, not by how hard they are.

### 1. The app says it saved when it saved nothing

`FR-02`, `FR-03`. The assistant replies *"I have saved your 22 expense at
Aroma"* and no expense exists — not on the dashboard, not in the database.
Found by hand first, now reproduced automatically.

**Why it is first:** the user believes their budget is recorded. It is not, and
nothing on screen ever tells them. Every other bug here announces itself.

### 2. A correction is silently ignored

`FR-10`. The user says `18`, then `actually it was 22`, then confirms. The
expense stores **18**. The correction is acknowledged in prose and dropped in
the payload.

**New this run.** Ordinary path, no edge case involved.

### 3. A negative amount is silently flipped positive

`XS-05`. `spent -50 on coffee` produces *"I've noted 50 under Food → Coffee.
Would you like me to save this expense?"* The minus sign is dropped, and the
user is asked to confirm a number they did not type.

Confirmed from the raw AI response, not inferred. **New this run.**

Related, same case at the API layer: an amount of `12.345` is accepted rather
than refused.

### 4. Reloading the page logs you out

`FR-16`, `FR-17`, `FR-18`, `UJ-01` — **one bug, four symptoms.**

`POST /users/refresh` fires twice on start-up (a double mount). Because refresh
*rotates* the token, the second call invalidates the first, and the loser's 401
can log out a user who just logged in.

**This is why `UJ-01` passed while reloading by hand logged you out.** The test
asserted the session survived; the race simply fell the other way that time.

### 5. A draft the app cannot read is dropped in silence

`FR-05`, plus six more instances discussed under "the disagreement" below.

The AI leaks its own deliberation into the `store` field — literally
*"let's use description… Wait, let's use store… Wait, rule-abiding…"*. The
server's guard catches it and logs `suspicious field (looks like leaked
JSON/HTML)`. The client then drops the draft without a word, leaving the user
with *"want me to add this?"* and no Confirm button to press.

A dead end on the core flow, and it happens often.

### 6. An empty chat message returns a 500

`FR-31`. One character away from trivially reachable by an ordinary user.

### 7. An expense can be saved with no label at all

`FR-13`, `LV-20`. A real expense with neither store nor description reached the
ledger. It shows as a blank row on the dashboard, permanently, with nothing to
identify it.

### 8. The app offers to edit an expense that does not exist

`BD-01`. On an account with no expenses, *"change the coffee expense to 30"*
gets *"Would you like me to update the coffee expense…"* — a false match
instead of a refusal. **New this run.**

### Also found, lower severity

- `FR-39` — the signup error reads *"User name must between 3 and 20
  characters"*: a missing word, and a field name that does not match its own
  label.
- `FR-42` — asked to total their spending, the user is told the app cannot do
  that, and never told the dashboard can.
- `LV-15` — `lv_steady`'s dashboard overflows horizontally at phone width once
  a category is expanded.
- `FR-38` — the nav's "Log in" and "Sign up" links measure 40 × 23 px and
  79 × 36 px, under the proposed 44 × 44 px minimum. **Provisional bar,
  unconfirmed.**
- `FR-43` — a Hebrew message gets an English reply. **Provisional bar,
  unconfirmed.**

---

## The disagreement, and why it matters

`qa-tester` filed six failures — `FR-08`, `FR-09`, `FR-13`, `FR-24`, `FR-28`,
`FR-44` — as **run artefacts**: the model was degenerating, so "not evidence
either way". It backed this with real evidence from `backend/logs/ai.log`: a
207,000-character response, an unterminated-JSON parse failure, and a field
repeating "pharmacy" hundreds of times.

`qa-lead` verified that evidence, confirmed it was true, and **rejected the
conclusion.**

The model was degenerating *by leaking its deliberation into the `store`
field* — which is exactly the defect `FR-05` catches and which is confirmed
real in the same run. The Confirm button never appeared in those six tests for
that reason. They are not noise. They are six more instances of a known severe
bug.

**Filing them as artefacts would have closed six instances of a live defect.**
This is the single most valuable thing the two-agent split produced tonight: a
grader that did not grade its own homework.

The tests are partly at fault too — they waited on a Confirm button rather than
asserting that the user is told something. That should be fixed, and the
verdict should still be *real defect*.

---

## Things the run proved about the app's AI layer

`backend/ai/` has **no output-length cap and no repetition guard.** A 207 KB
response from a budget-app parse is a wasted API call and a dead-ended user.

The prompt's store-versus-description rule is ambiguous enough that the model
visibly agonises over it in production — the deliberation text in the logs is
the model arguing with itself about which field to use.

One raw response contained text shaped like an instruction addressed to an AI
agent. `qa-lead` searched the logs for injection patterns and found none: it is
the model echoing fragments of earlier turns in the *same user's own session*
under repetition collapse. Context bleed, not injection, not cross-user. Worth
recording, not worth alarm.

---

## Two corrections to the earlier record

**`FR-01` — pressing Enter does work.** The 2026-09-16 exploratory notes
recorded that Enter did nothing in the chat composer. That was wrong.
`HomePage.tsx` has a real `<form onSubmit>` with a `type="submit"` button, git
shows it unchanged, and the automated test genuinely presses Enter and gets the
POST. The original observation came through a different automation layer and
was a tool artefact recorded as a product defect. **Worth five seconds of
confirming by hand.**

**`FR-21` is not a date-boundary bug.** "This month" showed only today's total.
Both server read paths use the same `startOfDay`/`endOfDay` UTC helpers
symmetrically, so an expense at `2026-09-01T00:00:00Z` does fall inside
`from=2026-09-01`. The likelier explanation is that the first-of-month expense
was never saved — the dead-end above, again. **One targeted re-run with a
seeded rather than AI-created expense settles it.**

---

## What is still not covered

Honest, and shorter than it should be.

| Gap | Why |
|---|---|
| **A5, the corrector** | `LV-04`/`LV-05` ran against ambiguity clusters the seeder built wrong — generic filler leaked into the curated clusters. Both cases are **unverified**, not passing |
| **A6, the returner** | `LV-17` is a tautology: it asserts a Confirm button is absent on a fresh load, which is unconditionally true because no draft is ever persisted server-side. It passed and proved nothing. `qa-lead` owns this — it said it would rewrite the case and did not |
| **Input diversity** | `LV-23` ran all 40 sentences but marks a send successful whether or not a draft appeared, and verifies by finding *any* expense with a matching amount. The sentences ran; nothing was proved |
| **"Nothing clipped", "no layout collapse"** | Needs visual-diff baselines that do not exist yet |
| **`FR-40`, design conformance** | Still a manual comparison against `docs/designs/` |
| **`FR-05`'s unit half** | Blocked: needs `buildPending` exported from `client/src/store/chatSlice.ts` |

**Coverage verdict:** materially better than "only the first evening has ever
been tested" — A2, A3, A4, A7 and A8 now have genuine lived-in coverage against
four accounts carrying two months of history. A5 and A6 remain empty, and the
"person watching" axis is thin.

---

## What this run says about the old suite

The 225 tests that were green while eleven bugs sat in the product failed for
five specific reasons, all confirmed here:

1. **Every test payload was written by the same mind that wrote the code** —
   all complete, all valid. Four of the eleven needed an *incomplete* input.
2. **The seams were never tested.** `backend/ai/` sends a category name;
   `backend/bl/` expected an id. Both halves passed their own tests.
3. **Nothing ever held a conversation.** Every chat test was one message long.
4. **Tests checked the reply, not what survived** a reload.
5. **Nobody ever looked at the screen.**

Four of the eight top defects above are new this run and none were among the
eleven previously-known bugs.

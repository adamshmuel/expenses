# Debugging, documenting and fixing a bug

How a bug goes from "QA found something" to "the user's flow works". This is
the flow that closed bugs 4, 6 and 7 from the 2026-09-17 automated run.

It sits on top of the other rules, it does not replace them:
`ownership.md` decides who writes the fix, `delegation.md` decides who may be
spawned, `product-first.md` decides when a bug is closed, `git.md` decides how
it is committed.

## 0. Every bug gets fixed

A bug found is a bug to fix. The only thing that closes a bug without a fix is
Adam saying so, in that turn, in as many words — "we're not fixing that",
"leave it", "not now".

- Low severity is not a reason to skip one. It is a reason to fix it later in
  the order, not to drop it.
- Never quietly park a bug as "known open", "minor", or "cosmetic" and move on.
  If it is not fixed and Adam has not waived it, it is still on the list.
- When a findings report is worked through, the round is done when every bug in
  it is either fixed or waived by Adam. Say which is which at the end.

## 1. Triage before touching any code

Given a findings report, for **every** bug:

- Read the report, then **trace the bug to its root cause in the real source**.
  A report names a symptom; the fix belongs where all callers route through,
  not where the symptom surfaced.
- Assign an owner from the table in `ownership.md`. Say which file, not just
  which folder.
- Write it down **before fixing anything**, in a **new** dated file
  `docs/reference/testing-reference/YYYY-MM-DD-bug-ownership.md`, per the
  never-edit-an-existing-file rule in `testing-reference.md`.

The point of writing it first is that the split gets decided once, on the
whole set, instead of re-argued bug by bug once fixing is underway.

## 2. Fix in owner order

- **Adam's code** (`backend/` outside `ai/`): Claude gives **one step at a
  time** and waits, per `communication.md`. Claude points at the file and
  line, explains the shape of the fix and why, and Adam writes it. Claude
  reads the file back when Adam says "check" and reports what is right, what
  is wrong, and what is missing — including anything Adam wrote that Claude
  did not suggest.
- **Claude's code** (`client/`, `backend/ai/`): written directly, or delegated
  to `builder` per `delegation.md`.
- Documentation and comments in Adam's files: only when Adam asks in that
  turn, per `ownership.md`. Offering to write them is fine; writing them
  unasked is not.

## 3. Verify every fix, one bug per round

After a fix, **propose** sending it to `qa-tester`, and wait for Adam's
approval before spawning — `delegation.md` applies, a bug fix is not itself a
request to delegate.

The ask must be narrow, or the agent will widen it:

- **One bug per round.** Never "verify these three fixes".
- **List the checks explicitly**, numbered, including the ones expected to
  pass unchanged — a fix that breaks a neighbouring case is the most common
  way a bug moves instead of closing.
- **Describe the fix as implemented**, in enough detail that the agent can
  tell intent from accident.
- **State the scope limits out loud**: no new test design, no
  `qa/test-roadmap.md` edits, no full-suite runs, clean up test data.
- If the fix changes a **constant the tests depend on**, say so, and ask the
  agent to read it from source rather than hardcode it.

## 4. A failed verification means the bug is still open

Per `product-first.md`: not a new ticket, not a follow-up, the same bug.

Bug 4 took three rounds. Each fix was correct and each one exposed the next
layer:

| Round | Fix | What it exposed |
|---|---|---|
| 1 | atomic rotation | identical tokens within one second → `E11000` → bogus 401 |
| 2 | random `jti` | any rotated token replayable for its full 7 days |
| 3 | `replacedAt` + grace window | nothing; closed |

Rounds 1 and 2 each *looked* finished. Neither was. **Re-verify the whole
flow after every round**, not just the line that changed, and resume the same
`qa-tester` rather than spawning a fresh one — it already has the context and
its own reproduction.

When a fix trades one property for another (round 3 left a 3-second replay
window), **say so to Adam in plain terms** and let him set the value. Do not
bury a tradeoff in a commit message.

## 5. Stale tests are their own round

A fix that invalidates an existing test assertion does **not** get that test
updated in the same breath. `qa/` is the QA agents' territory
(`ownership.md`), and a test changed alongside the code it guards stops being
independent evidence.

Report which tests went stale and why, ask, and send it back as its own
scoped round once Adam approves. Never change a test to make a fix look
green — `tdd.md`.

## 6. Update the spec the fix touched

Per `sdd.md`, the spec is the source of truth for what the code does — a bug
fix that changes behaviour and leaves the spec describing the old behaviour
is a spec bug from the moment the fix lands, not something to catch later in
a batch.

Once a fix is verified (§4), check whether it changed anything a spec under
`docs/specs/` describes — a function's steps, a schema field, a case in a
"cases to handle" table. If it did, update that spec in the same round,
before moving to the next bug. Small, targeted edits to the section the fix
touched — not a rewrite of the file, and not a chance to also cover unrelated
drift noticed along the way; a wider clean-up gets its own round.

This is `docs/`, so it follows `ownership.md`'s normal rule: Claude drafts,
Adam approves. It is not `docs/reference/testing-reference/`'s
never-edit-an-existing-file rule — specs are living documents that get edited
in place as the product they describe changes.

## 7. Commit per logical change

Per `git.md`: output the commands for Adam to run, never run them, one
command block per commit so each can be copied on its own. Unrelated changes
caught in the same session — tooling config, an unrelated doc — stay
unstaged and get mentioned, not bundled. A spec update from §6 is part of the
same logical change as the fix it documents, so it belongs in that commit,
not a separate one.

# Who writes what

Adam is the student. This project is his Node.js course final project, so the
server code must be his own work.

| Path | Who writes the code |
|---|---|
| `backend/` (everything except `backend/ai/`) | **Adam only** |
| `backend/ai/` | **Claude** |
| `client/` | **Claude** |
| `docs/`, `.claude/` | Claude drafts, Adam approves |
| `qa/` | **The `qa-lead` and `qa-tester` subagents** — see below |

This is enforced, not just asked: `.claude/hooks/protect-backend.py` refuses any
write under `backend/` outside `ai/`, for Claude and every subagent. The hook
allows one narrow exception — see "Documentation and inline comments" below —
which it checks structurally (diffing code lines), not by trusting intent.

## On Adam's server code

Claude acts as a **mentor and teacher**, not a contributor.

- Never write, edit, fix, or refactor code under `backend/`.
- Never volunteer a code suggestion. Explain the concept and let Adam write it.
- When asked a question, answer it. Do not jump to changing files.
- Reviewing, explaining, and pointing at a bug is allowed and encouraged.

Exceptions, only when Adam explicitly asks for them:
- Writing documentation for the server.
- Adding mock/seed data to the database.

### Documentation and inline comments

The hook additionally permits edits under `backend/` (outside `ai/`) that add
or change **only** comments, JSDoc blocks, or docstrings — the underlying code
must be byte-identical before and after. This is a structural allowance, not a
standing permission: **Claude only writes documentation or inline comments in
`backend/` when Adam explicitly asks for it in that turn.** Never volunteer it,
and never use it as a way to sneak in a real code change. If a requested change
touches any code line, stop and explain what Adam needs to write instead.

## On Claude's code

Claude writes `client/` and `backend/ai/` freely, following the other rules in
this folder.

`backend/ai/` is a self-contained folder. It exposes plain functions that Adam's
server calls. Claude does not reach outside that folder.

## On `qa/`

Everything under `qa/` is the QA subagents' responsibility, not the main
session's, split between them:

| Under `qa/` | Who writes it |
|---|---|
| Test specs, roadmap, flow analysis, exploratory field notes | **`qa-lead`** |
| Automation, fixtures, harness, environment builders, run reports | **`qa-tester`** |

`qa-lead` designs the cases and stops; Adam approves them; `qa-tester` then
implements and runs them. Per `.claude/rules/delegation.md`, Claude does not
write under `qa/` directly and does not spawn either agent without Adam's
explicit ask — it may suggest doing so and wait for approval.

`docs/reference/testing-reference/` is **not** under `qa/` and is not covered
by this row — ordinary `docs/` rules apply (Claude drafts, Adam approves).

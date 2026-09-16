# Updating docs/reference/testing-reference/

This folder is not under `qa/` (see `.claude/rules/ownership.md`) — Claude
writes it directly, in the main session, following `docs/` rules (Claude
drafts, Adam approves).

When Adam says "update docs/reference/testing-reference" or similar:

1. **Read the existing files and diff it yourself.** Read every file already
   in the folder, then read the actual source (`backend/`, `client/`, specs,
   git log/diff) to find what's new or changed since each file's own
   `## Derivation state` marker. Do not delegate the diffing — do it in the
   main session.
2. **Never edit an existing dated file.** The `qa-lead` agent's own convention
   (see the folder's `README.md`) allows updating an existing area file in
   place, but that convention assumes `qa-lead` is the one making the edit and
   can track its own changes. Claude cannot rely on that — a rewrite here would
   be invisible to `qa-lead`'s own tracking. So every update from Claude, whether
   it's a new area or growth of an existing one, goes into a **new**
   `YYYY-MM-DD-<area>-testable.md` file, dated with today's date. Leave prior
   files untouched.
3. **Stop there.** Writing (or updating) this folder is never, by itself, a
   reason to invoke `qa-lead` or `qa-tester`. Do not trigger either — to run
   tests, write automation, or anything else — without Adam's explicit approval
   first, per the "No unrequested delegation" section of
   `.claude/rules/delegation.md`.

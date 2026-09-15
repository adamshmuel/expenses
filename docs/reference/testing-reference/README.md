# Testing reference

Not a spec. This folder is the `qa` agent's living map of **what exists and can
be tested**, split one file per area so no single file grows unbounded.

## The convention

- **One file per distinct testable area**, named `YYYY-MM-DD-<area>-testable.md`
  — the date is when that file was **created**, not last edited. Existing files:

  | File | Area |
  |---|---|
  | `2026-09-11-server-testable.md` | `backend/` (everything except `ai/`), as of `e48ce5b` |
  | `2026-09-11-client-testable.md` | `client/`, as of `e48ce5b` |
  | `2026-09-15-ai-testable.md` | `backend/ai/` |
  | `2026-09-15-server-additions-testable.md` | `backend/` growth since `e48ce5b` (chat/expense/category routes, services, models) |
  | `2026-09-15-client-additions-testable.md` | `client/` growth since `e48ce5b` (chat UI committed; dashboard UI uncommitted — see file) |

- **When a genuinely new area of the system appears** — `backend/ai/` once it's
  built, a mobile app, a second service — it gets its **own new dated file**,
  not a new section bolted onto an existing one. That is what keeps any single
  file from becoming the unbounded do-everything document the original
  `testable-surface.md` was turning into.
- **When an existing area grows** (a new route, a new component, a new module),
  update that area's existing file in place — add rows, don't create a
  duplicate file for the same area.
- The date in the filename is a creation timestamp, useful for knowing what's
  new at a glance. It is **not** a "last scanned" marker — each file's own
  header states when it was last re-derived.
- **If a file gets too long, split it.** A single area file that grows past a
  comfortable read is a context risk for the agent, not a badge of
  thoroughness. Split it into more files (e.g. by sub-area, or by route vs.
  model vs. service layer) rather than letting one file carry the whole area.
  Update the table above to list each resulting file.

## What belongs in one of these files

Per the format each existing file already uses: what exists (a function, a
route, a component, a module), what it's governed by (the `docs/specs/` section
that fixes its intended behaviour), and what kind of testing it invites (the
agent's judgement prompt, not a prescription). No test counts, no pass/fail, no
strategy prose — that lives in `qa/`.

## Two different costs — reading vs. re-deriving

Every file here needs a `## Derivation state` section (see the two existing
files for the exact shape): the source paths it covers, and the commit its rows
were last verified against.

- **Reading a file is cheap** — it is a compact inventory, not the source code.
  **On every run the agent reads every file in this folder, in full, no
  exceptions.** This is how it knows what already exists elsewhere in the
  system — a client test designed today may depend on a server function an
  earlier run already inventoried, and the agent must see that without
  re-deriving it.
- **Re-deriving a file is expensive** — it means re-opening the real source
  files it covers, re-checking every row, and rewriting what changed. The
  `## Derivation state` commit marker gates **this** step only: before
  re-deriving, the agent diffs that commit against the current tree for the
  file's covered paths. No changes → skip re-deriving that file, note it as
  still current, move on. Changes → re-derive only the affected rows.

**The gate never skips the read, only the re-derivation.** A file the agent
decides not to re-derive this run is still read in full, so its inventory stays
available to inform every other area's test design.

A new dated file appearing here since the last run has no prior derivation
state, so it is always read and always derived in full on the run that first
sees it.

---
name: test-strategy
description: >-
  Produce a testing ROADMAP for code that already exists: inventory every module
  and endpoint that has been built, decide what kind of test each one needs (unit
  / API / integration / E2E), note what blocks it, and order the work by
  risk-to-effort. Output is a short, actionable roadmap file — not a multi-quarter
  strategy document. Use when: "test roadmap," "what can we test now," "testing
  plan for what's built," "map tests to the code," "where do we start testing."
  Not for: identifying which areas carry the most risk in the abstract — use
  risk-based-testing. Not for: a formal go/no-go release checklist — use
  release-readiness.
  Related: unit-testing, api-testing, test-data-management, playwright-automation.
license: MIT
metadata:
  author: kindlmann
  version: "2.0-roadmap"
  category: strategy
---

<objective>
Turn a codebase that has little or no test coverage into a concrete, ordered
list of tests to write. This skill does NOT write a strategy essay or set
quarterly KPIs. It walks the code that exists today, matches each unit to the
cheapest test level that would catch its real failure modes, flags anything that
blocks testing (no fixtures, no test DB, a module doing I/O that should be
injected), and produces a roadmap ordered so the highest-value tests come first.
The output is a file the developer works through top to bottom.
</objective>

---

## When to use this

- A feature or subsystem has been built and manually verified, but has no
  automated tests, and you want a plan for adding them.
- You inherited code and need to know what is testable now versus what needs
  refactoring first.
- A small project (days-to-weeks, one or two developers) where a full
  `test-strategy` document would be overkill but "just start writing tests" would
  miss things.

If the code does not exist yet, this is the wrong skill — write the spec and the
code first. If you need to rank business risk before you know what to test, run
`risk-based-testing`.

---

## Discovery

Check `.agents/qa-project-context.md` first — if it exists, use it and skip
anything already answered. Then gather:

1. **What has been built?** List the source files/modules in scope. Read them —
   this skill is grounded in the actual code, not a description of it.
2. **What test framework is already in the repo?** Check `package.json` /
   `pyproject.toml`. Match it; do not introduce a second runner.
3. **What tests exist already?** Count them and note where they live, so the
   roadmap adds to that structure instead of starting a parallel one.
4. **What infrastructure is available for tests?** A test database? A way to run
   the server in-process? Fixtures or factories? If none, that becomes an early
   roadmap item, not an assumption.
5. **What is explicitly out of scope?** Third-party code, generated code, throwaway
   scripts, anything slated for deletion.

---

## Core principles

1. **Ground every roadmap item in a file that exists.** Each row names a real
   module or endpoint. No aspirational "we should test the payment flow" when
   there is no payment flow.

2. **Cheapest level that catches the real failure.** A function with branching
   logic and no I/O is a unit test. An endpoint's status codes, response shape,
   and auth boundary are an API test. A cross-module flow through the database is
   an integration test. A user journey through the browser is E2E. Push each
   item down to the cheapest level that would actually fail when the code is
   wrong.

3. **Name the blocker, do not skip the item.** If a module can't be unit-tested
   because it reaches out to the network directly, the roadmap says "blocked:
   extract the HTTP call behind a parameter" — it doesn't silently drop the
   module.

4. **Order by value, not by file order.** Highest risk × lowest effort first.
   Auth, data integrity, and money before formatting and rendering.

5. **Small and finishable.** The roadmap fits on one screen. If it has forty
   items, the scope is too big — split it.

---

## Steps

### 1. Inventory the code

Read each in-scope module. For every exported function / class / route handler,
write one line: what it does, what it depends on, and what its failure modes are
(wrong output, unhandled error, wrong status code, data corruption, security
hole).

### 2. Assign a test level to each item

Use this table. Pick the **lowest** row that catches the failure modes from
step 1.

| Level | Fits when | Typical tools |
|-------|-----------|---------------|
| **Unit** | Pure logic, branching, edge cases; dependencies can be passed in or mocked. No real DB / network / filesystem. | Vitest, Jest, pytest |
| **API** | An HTTP endpoint. You care about status codes, response body shape, headers, auth boundaries, validation errors. | Supertest, Playwright APIRequestContext |
| **Integration** | A path that crosses module boundaries and touches a real (test) database or a real in-process server. | Supertest + a test DB, Testcontainers |
| **E2E** | A user journey through the actual UI and the real backend. Reserve for the few critical flows. | Playwright, Cypress |

If an item needs a level its infrastructure doesn't support yet, mark it
**blocked** and add the infrastructure as its own roadmap item.

### 3. Score risk and effort

For each item, two quick 1–3 scores:

- **Risk** — 3: auth, data integrity, money, anything a bug here is
  hard to notice or hard to reverse. 2: user-visible feature breakage.
  1: cosmetic, easily spotted.
- **Effort** — 1: pure function, no setup. 2: needs a fixture or a mock.
  3: needs new infrastructure (test DB, server harness, seed data) first.

Order the roadmap by **risk descending, then effort ascending**. High-risk /
low-effort items are the top of the list.

### 4. Write the roadmap file

Save to an agreed path (default `docs/test-roadmap.md`). Structure:

```markdown
# Test roadmap

_State: what exists now — framework, current test count, test infrastructure._

## Blockers to clear first

| # | Item | Why it blocks | Effort |
|---|------|---------------|--------|
| B1 | ... | ... | ... |

## Roadmap

| # | Target (file) | Level | What the test asserts | Risk | Effort | Depends on |
|---|---------------|-------|-----------------------|------|--------|-----------|
| 1 | bl/userService.js — login() | unit | wrong password and unknown user both throw one 401; correct creds return a token pair | 3 | 1 | — |
| 2 | routes/userRoute.js — POST /users/signup | API | 201 + {user, accessToken} + Set-Cookie on success; 400 errors[] shape on bad body; 409 on duplicate | 3 | 2 | B1 |
| ... |

## Out of scope (and why)

- ...

## Not covered, accepted

- Anything real that will not get a test in this round, stated plainly so it is a
  decision and not an oversight.
```

### 5. Sanity-check

- Every roadmap row names a file that exists in the repo.
- Every "blocked" item has a corresponding blocker row it depends on.
- The list is ordered risk-desc, effort-asc.
- Nothing critical (auth, data integrity) is sitting in "not covered, accepted"
  without an explicit reason.
- The roadmap fits on one screen. If not, split by subsystem.

---

## Anti-patterns

**Strategy essay.** Paragraphs about testing philosophy, pyramid theory, and
quality culture. This skill produces a table of things to do, each tied to a
file.

**Quarterly cadence and KPI dashboards.** Defect-escape-rate targets, flakiness
thresholds, review calendars. That is `test-strategy` at company scale and
`qa-metrics`. A small project's roadmap is done when the list is done.

**Everything at E2E.** Writing a browser test to check logic that a unit test
would catch faster. Assign the cheapest level in step 2.

**Testing what isn't there.** Roadmap rows for features that don't exist yet.
Only real code gets a row.

**Ignoring blockers.** Marking a hard-to-test module "later" with no note. Name
the refactor that unblocks it and put it in the blockers table.

**A forty-row roadmap.** Too big to finish, so it doesn't get finished. Split it
or cut it to the items that matter this round.

---

## Verification

Run against the saved roadmap:

```bash
DOC=docs/test-roadmap.md
# Every "Target (file)" cell points at a path that exists
grep -oE '[a-zA-Z0-9_./-]+\.(js|ts|jsx|tsx|py)' "$DOC" | sort -u | while read f; do
  [ -e "$f" ] || echo "MISSING: $f"
done
# The roadmap has a Blockers section and an Out-of-scope section
grep -qiE '## blockers' "$DOC" && grep -qiE 'out of scope' "$DOC" && echo "structure OK"
```

Then read the ordering by eye: risk should not increase as you go down the list
while effort stays flat.

---

## Done when

- [ ] A roadmap file exists at an agreed path.
- [ ] Every row names a real file in the repo.
- [ ] Each row has a test level chosen as the cheapest that catches its failure
      modes.
- [ ] Blockers (missing test DB, fixtures, or a needed refactor) are listed
      separately and referenced by the rows that depend on them.
- [ ] The list is ordered highest-value first (risk desc, effort asc).
- [ ] Anything real but deliberately untested this round is under "not covered,
      accepted" with a reason.

---

## Related skills

- **unit-testing** — how to write the unit rows: doubles taxonomy, coverage
  gating, fake timers.
- **api-testing** — how to write the API rows: schema-as-contract, auth-flow
  tests, status/header assertions.
- **test-data-management** — clear the "no fixtures / no seed data" blocker with
  factories and idempotent seeds.
- **playwright-automation** — how to write the few E2E rows once they earn their
  place.
- **risk-based-testing** — run first if you need a scored business-risk matrix
  before deciding what to test.

## Reference files (in `references/`)

The bundled reference files (`diagrams-and-worksheets.md`,
`strategy-templates.md`) are from the original multi-quarter version of this
skill. They contain the 5x5 risk matrix and four worked company-scale strategy
documents. Use the risk matrix if step 3's 1–3 scoring is too coarse; ignore the
worked strategy documents — they are the format this roadmap version deliberately
does not produce.

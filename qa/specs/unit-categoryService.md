# Test spec — `bl/categoryService.js` (unit)

**Under test:** `backend/bl/categoryService.js` — `findByName`, `createCategory`, `updateCategory`, `deleteCategory`.
**Governing spec:** `docs/specs/09-expense-category-service.md` §2; category rules also in `docs/specs/04-data-model.md` "Category".
**Level:** unit. `categoryRepository` is replaced with a test double (`loadCjsWithStubs`, same pattern as `qa/tests/unit/userService.test.ts`). No database. `seedDefaultCategories`/`resetToDefaults` need a real DB (batch inserts, cascading deletes) — covered separately in `qa/specs/int-categoryService.md`.
**Automation:** `qa/tests/unit/categoryService.test.ts`.

Doubles: `categoryRepository` — full mock, every export a `vi.fn()`.

---

### CS-01 — `findByName` matches case-insensitively
- **Purpose:** free text like "fuel" must find a category named "Fuel" (spec §2 `findByName`).
- **Method:** `getCategoriesByUser` resolves `[{_id:"c1", name:"Fuel", parent:null}]`. Call `findByName("u1", "fuel")`.
- **Expected:** returns the one match.

### CS-02 — `findByName` scopes by parent when given
- **Purpose:** the chat's category search can be narrowed to subcategories of one main (spec §2).
- **Method:** `getCategoriesByUser` resolves two categories named "Coffee" under different parents `p1`/`p2`. Call `findByName("u1", "coffee", "p1")`.
- **Expected:** returns only the `p1` match.

### CS-03 — `findByName` returns zero, one, or several matches
- **Purpose:** the caller (route / `resolveCategory`) decides behaviour from the count (spec §2).
- **Method:** `getCategoriesByUser` resolves zero, then one, then two same-named categories (no parent filter) across three calls.
- **Expected:** `findByName` resolves an array of length 0, 1, 2 respectively.

### CS-04 — `createCategory` with no `parent` creates a main category
- **Purpose:** happy path, `parent` defaults to `null` (spec §2 step 3).
- **Method:** `getCategoriesByUser` resolves `[]` (no duplicate). `createCategory` resolves the saved doc. Call `createCategory("u1", { name: "Pets" })`.
- **Expected:** `categoryRepository.createCategory` called once with `{ name: "Pets", parent: null, owner: "u1" }`.

### CS-05 — `createCategory` with a `parent` that does not exist → 400
- **Purpose:** spec §2 step 1, "not found ... → throw 400".
- **Method:** `getCategoriesByUser` resolves `[]`. Call `createCategory("u1", { name: "Pets", parent: "ghost" })`.
- **Expected:** rejects with `{ status: 400, message: "No such category to add a subcategory to." }`. `categoryRepository.createCategory` never called.
- **Corrected 2026-09-16** — this test (and CS-06/CS-07 below) used to mock `findCategoryById`, matching an older implementation that resolved `parent` **by id**. Bug 9 (`2026-09-16-chat-flow-bugs-and-fixes.md`) changed `createCategory` to resolve `parent` **by name** via `findByName` → `getCategoriesByUser` (the AI always sends a parent *name*, never an id — that mismatch was bug 9 itself). These three tests still mocked the old seam and were passing for the wrong reason until this pass's full-suite run caught the drift (`TypeError: Cannot read properties of undefined (reading 'filter')` — `getCategoriesByUser` was never mocked, so `findByName`'s internal `.filter` call blew up). Fixed to mock the seam the current code actually calls.

### CS-06 — `createCategory` with an ambiguous `parent` name (2+ matches) → 400
- **Purpose:** the multi-match branch of `createCategory`'s own parent resolution (distinct from `resolveCategory`'s equivalent branch for expenses, covered by `qa/specs/api-chat-confirm-resolution.md` CR-04) — untested at any level before this pass. **Replaces** the old CS-06 ("parent owned by another user"), which described a scenario the current implementation cannot reach: `findByName` already scopes its search to `getCategoriesByUser(userId)`, so a same-named category belonging to a different user is never even a candidate — the `owner` check on the resolved `parentDoc` is a defensive line that the public API can no longer trigger, not a reachable branch worth a dedicated test.
- **Method:** `getCategoriesByUser` resolves two categories both named `"p1"` (e.g. one main, one sub of a different main) for user `"u1"`. Call `createCategory("u1", { name: "Pets", parent: "p1" })`.
- **Expected:** rejects with `{ status: 400, message: 'More than one category named "p1".' }`. `categoryRepository.createCategory` never called.

### CS-07 — `createCategory` with a `parent` that is itself a subcategory → 400 (two-level rule)
- **Purpose:** spec §2 step 1, three-level rejection.
- **Method:** `getCategoriesByUser` resolves `[{ _id: "p1", name: "p1", owner: "u1", parent: "grandparent" }]`. Call `createCategory("u1", { name: "X", parent: "p1" })`.
- **Expected:** rejects with `{ status: 400, message: "Categories can only be two levels deep." }`.

### CS-08 — `createCategory` with a duplicate name under the same parent → 409
- **Purpose:** spec §2 step 2, matches the compound unique index.
- **Method:** no `parent`. `getCategoriesByUser` resolves `[{ _id: "c1", name: "Pets", parent: null }]`. Call `createCategory("u1", { name: "Pets" })`.
- **Expected:** rejects with `{ status: 409, message: 'A category named "Pets" already exists here.' }`. `categoryRepository.createCategory` never called.

### CS-09 — `updateCategory` on a missing or foreign category → 404
- **Purpose:** spec §2 `updateCategory` step 1.
- **Method:** case A — `findCategoryById` resolves `null`. case B — resolves `{ _id: "c1", owner: "someone-else" }`. Call `updateCategory("u1", "c1", { name: "New" })` in both.
- **Expected:** both reject `{ status: 404, message: "Category not found." }`.

### CS-10 — `updateCategory` on `isProtected` → 400
- **Purpose:** "Other" cannot be renamed (spec §2 step 2).
- **Method:** `findCategoryById` resolves `{ _id: "c1", owner: "u1", isProtected: true }`. Call `updateCategory("u1", "c1", { name: "Renamed" })`.
- **Expected:** rejects `{ status: 400, message: '"Other" cannot be renamed.' }`.

### CS-11 — `updateCategory` duplicate name under the same parent (excluding self) → 409
- **Purpose:** spec §2 step 3 — a genuine collision with a *different* sibling.
- **Method:** `findCategoryById` resolves `{ _id: "c1", owner: "u1", parent: null, isProtected: false }`. `getCategoriesByUser` resolves `[{ _id: "c1", name: "Pets", parent: null }, { _id: "c2", name: "Pets", parent: null }]` (two categories share the target name — `c1` itself and a sibling `c2`). Call `updateCategory("u1", "c1", { name: "Pets" })`.
- **Expected:** rejects `{ status: 409, message: 'A category named "Pets" already exists here.' }` — the match against `c2` (not `c1`) is what trips it.

### CS-12 — `updateCategory` renaming to its own current name does NOT 409 (self-exclusion)
- **Purpose:** the one behaviour that differs from `createCategory`'s duplicate check (spec §2 step 3, "the category being renamed can match its own current name").
- **Method:** `findCategoryById` resolves `{ _id: "c1", owner: "u1", parent: null, isProtected: false }`. `getCategoriesByUser` resolves `[{ _id: "c1", name: "Pets", parent: null }]` (only itself matches). `updateCategory` resolves the updated doc. Call `updateCategory("u1", "c1", { name: "Pets" })`.
- **Expected:** resolves (no throw). `categoryRepository.updateCategory` called once with `("c1", { name: "Pets" })`.

### CS-13 — `deleteCategory` on a missing/foreign category → 404, on `isProtected` → 400, happy path delegates
- **Purpose:** spec §2 `deleteCategory` steps 1–3.
- **Method:** three sub-cases — (a) `findCategoryById` → `null`; (b) → `{ owner: "other" }`; (c) → `{ owner: "u1", isProtected: true }`; (d) → `{ owner: "u1", isProtected: false }`, `categoryRepository.deleteCategory` resolves.
- **Expected:** (a)/(b) reject 404 "Category not found."; (c) rejects 400 `'"Other" cannot be deleted.'`; (d) resolves, `categoryRepository.deleteCategory` called once with the id.

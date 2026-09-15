# Test spec — `bl/categoryService.js` (integration: `seedDefaultCategories`, `resetToDefaults`)

**Under test:** `backend/bl/categoryService.js` — `seedDefaultCategories`, `resetToDefaults`.
**Governing spec:** `docs/specs/09-expense-category-service.md` §2; `docs/specs/04-data-model.md` "Category".
**Level:** integration — real Mongo. These round-trip through `categoryRepository.createManyCategories` (`insertMany`, needs real `_id` generation across two passes) and `expenseRepository.reassignExpensesToCategory`/`categoryRepository.deleteCategoriesByUser` (real cascading writes + the `pre("deleteMany")` hook under test in `int-categoryModel.md`). Not mocked — `categoryService`, its real DAL, and the real models are all loaded together, connected to `expenses_qa_test` via backend's own mongoose singleton (same approach as `int-categoryModel.md`).
**Automation:** `qa/tests/integration/categoryService.test.ts`.

---

### CI-01 — `seedDefaultCategories` produces 8 mains with the right sub counts
- **Method:** `categoryService.seedDefaultCategories(userId)`.
- **Expected:** resolves an array of 8 + 9 = 17 documents (`constants/defaultCategories.js`: Food×3, Transport×3, Home×3, Health×0, Clothing×0, Entertainment×0, Education×0, Other×0). Exactly 8 documents have `parent` unset; each of the 9 subcategory documents' `parent` matches its intended main's `_id` (by name lookup in the result set).

### CI-02 — `seedDefaultCategories`: "Other" comes out `isProtected: true`, every other main does not
- **Method:** same call as CI-01; inspect the "Other" document and one other main (e.g. "Food").
- **Expected:** the document named `"Other"` has `isProtected === true`; `"Food"` has `isProtected === false`.

### CI-03 — `resetToDefaults` reassigns every expense to the (new) "Other" before wiping categories
- **Method:** seed one user's default categories (`seedDefaultCategories`). Create one expense pointing at the seeded "Food" category, another pointing at the seeded "Other". Call `categoryService.resetToDefaults(userId)`.
- **Expected:** resolves a fresh set of default categories (8 mains + 9 subs, same shape as CI-01). Both expenses, re-read, now point at the **new** "Other" `_id` — which differs from the original "Other" `_id` (the old categories, including the old "Other", are gone: `Category.findById(<old Other id>)` is `null`).

### CI-04 — `resetToDefaults` leaves no orphaned category ids and matches `seedDefaultCategories`'s shape
- **Method:** after CI-03's reset, query `Category.find({ owner: userId })`.
- **Expected:** exactly 17 documents (8 mains + 9 subs), the same counts as a fresh `seedDefaultCategories` call — none of the pre-reset category ids appear.

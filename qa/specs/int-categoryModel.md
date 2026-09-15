# Test spec — `models/categoryModel.js` middleware hooks (integration)

**Under test:** `backend/models/categoryModel.js` — `pre("save")`, `pre("findOneAndUpdate")`, `pre("findOneAndDelete")`, `pre("deleteMany")`.
**Governing spec:** `docs/specs/04-data-model.md` "Category"; `docs/specs/09-expense-category-service.md` §2 (reset).
**Level:** integration — real Mongo (`expenses_qa_test`). These hooks call `mongoose.model("Category")`/`mongoose.model("Expense")` on the **global** default mongoose connection (not a query-scoped `this.model` in every case), so the test connects backend's own `mongoose` singleton (`require("mongoose")` resolved from `backend/`) directly — the same way `backend/.config/db.js` does — rather than a separate `mongoose.createConnection`. Four hooks were dormant before this pass (no route touched `Category`); `categoryService` now exercises them.
**Automation:** `qa/tests/integration/categoryModel.test.ts`.

---

### CH-01 — `pre("save")` rejects `isProtected: true` on anything but "Other"
- **Method:** `new Category({ name: "Fake Other", owner: <oid>, isProtected: true }).save()`.
- **Expected:** rejects with an error mentioning "protected".

### CH-02 — `pre("save")` rejects a `parent` that does not exist
- **Method:** `new Category({ name: "Sub", owner: <oid>, parent: <a fresh, never-saved ObjectId> }).save()`.
- **Expected:** rejects with an error mentioning "Parent category does not exist".

### CH-03 — `pre("save")` rejects a `parent` that is itself a subcategory (blocks 3 levels)
- **Method:** save a main category `A`, then a sub `B` under `A`. Attempt `new Category({ name: "C", owner: <oid>, parent: B._id }).save()`.
- **Expected:** the third-level save rejects with an error mentioning "cannot have a parent that is itself a subcategory".

### CH-04 — `pre("save")` allows a valid main category
- **Method:** `new Category({ name: "Main", owner: <oid> }).save()`.
- **Expected:** resolves; the saved doc has `parent` unset.

### CH-05 — `pre("save")` allows a valid subcategory
- **Method:** save a main `A`; `new Category({ name: "Sub", owner: <oid>, parent: A._id }).save()`.
- **Expected:** resolves; the saved doc's `parent` equals `A._id`.

### CH-06 — `pre("findOneAndUpdate")` blocks renaming a protected category
- **Method:** seed a category `{ name: "Other", isProtected: true }`. `Category.findOneAndUpdate({ _id }, { name: "Renamed" })`.
- **Expected:** rejects with an error mentioning "cannot be renamed".

### CH-07 — `pre("findOneAndUpdate")` blocks unprotecting a protected category
- **Method:** same seed. `Category.findOneAndUpdate({ _id }, { isProtected: false })`.
- **Expected:** rejects with an error mentioning "cannot be unprotected".

### CH-08 — `pre("findOneAndUpdate")` blocks setting a `parent` that does not exist
- **Method:** seed a non-protected category. `Category.findOneAndUpdate({ _id }, { parent: <a fresh ObjectId> })`.
- **Expected:** rejects with an error mentioning "Parent category does not exist".

### CH-09 — `pre("findOneAndUpdate")` blocks setting a `parent` that is itself a subcategory
- **Method:** seed main `A`, sub `B` under `A`, and a plain category `C`. `Category.findOneAndUpdate({ _id: C._id }, { parent: B._id })`.
- **Expected:** rejects with an error mentioning "cannot have a parent that is itself a subcategory".

### CH-10 — `pre("findOneAndUpdate")` allows a normal rename of a non-protected category
- **Method:** seed a plain category. `Category.findOneAndUpdate({ _id }, { name: "New Name" }, { new: true })`.
- **Expected:** resolves; the returned doc's `name` is `"New Name"`.

### CH-11 — `pre("findOneAndDelete")` rejects deleting a protected category
- **Method:** seed `{ name: "Other", isProtected: true }`. `Category.findOneAndDelete({ _id })`.
- **Expected:** rejects with an error mentioning "cannot be deleted".

### CH-12 — `pre("findOneAndDelete")` on a subcategory reassigns its expenses to "Other" before deleting
- **Method:** seed `Other` (protected), main `A`, sub `B` under `A`; seed one `Expense` pointing at `B`. `Category.findOneAndDelete({ _id: B._id })`.
- **Expected:** resolves; re-reading the expense shows `category === Other._id`; `Category.findById(B._id)` is now `null`.

### CH-13 — `pre("findOneAndDelete")` on a main category reassigns its own + its subs' expenses, and deletes the subs too
- **Method:** seed `Other`, main `A`, subs `B1`/`B2` under `A`; seed one expense on `A` directly, one on `B1`, one on `B2`. `Category.findOneAndDelete({ _id: A._id })`.
- **Expected:** resolves; all three expenses now point at `Other._id`; `Category.findById` for `A`, `B1`, and `B2` are all `null`.

### CH-14 — `pre("deleteMany")` rejects a filter that would remove a protected category
- **Method:** seed `Other` (protected) and a plain category, both owned by the same user. `Category.deleteMany({ owner: userId, isProtected: false })` — wait, that shape wouldn't match Other; instead use a filter that *would* match it: `Category.deleteMany({ _id: { $in: [Other._id, plain._id] } })`.
- **Expected:** rejects with an error mentioning "Protected categories cannot be deleted". Both documents still exist afterward.

### CH-15 — `pre("deleteMany")` allows a filter matching only unprotected categories
- **Method:** seed two plain (non-protected) categories for the same user. `Category.deleteMany({ owner: userId, isProtected: false })`.
- **Expected:** resolves; both documents are gone. The user's "Other" (seeded separately, protected) still exists.

### CH-16 — `pre("deleteMany")` lets the single-key `{ owner }` reset filter through even though it matches "Other"
- **Method:** seed `Other` (protected) and two plain categories, all for one user. `Category.deleteMany({ owner: userId })` — the exact shape `resetToDefaults` uses.
- **Expected:** resolves; all three documents (including the protected "Other") are gone.

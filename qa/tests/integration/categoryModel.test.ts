/**
 * Integration tests for backend/models/categoryModel.js middleware hooks.
 * Test spec: qa/specs/int-categoryModel.md  (CH-01 .. CH-16)
 * Governing spec: docs/specs/04-data-model.md "Category"; 09-expense-category-service.md §2.
 *
 * The hooks in categoryModel.js call mongoose.model("Category")/mongoose.model("Expense")
 * on the GLOBAL default mongoose connection (not a query-scoped `this.model` in
 * every case), so this test connects backend's own mongoose singleton
 * directly, the same way backend/.config/db.js does.
 *
 * FINDING (see the run report): every one of these hooks is declared
 * `async function (next) {...}` and calls `next()`/`next(err)` inside an
 * async function. In the installed Mongoose version this throws
 * "TypeError: next is not a function" on EVERY branch, success or rejection
 * -- confirmed independently of this harness with a plain `node -e` script
 * against backend's own code (see the run report). This means every
 * single-document Category write (.save(), findOneAndUpdate, findOneAndDelete,
 * deleteMany) is currently broken; only insertMany (used by
 * seedDefaultCategories at signup) escapes because Mongoose does not run
 * 'save' middleware for insertMany. Fixture categories that are NOT the
 * document under test are therefore seeded via insertMany
 * (categoryRepository.createManyCategories) below, to isolate each test's
 * assertion to the one hook invocation actually being tested.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const rb = createRequire(resolve(BACKEND, "package.json"));
const backendMongoose = rb("mongoose") as typeof import("mongoose");

let Category: any;
let Expense: any;
let categoryRepository: any;
const oid = () => new backendMongoose.Types.ObjectId();

beforeAll(async () => {
  const be = readBackendEnv();
  await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  Category = rb("./models/categoryModel.js");
  Expense = rb("./models/expenseModel.js");
  categoryRepository = rb("./dal/categoryRepository.js");
});

afterAll(async () => {
  await backendMongoose.connection.dropCollection("categories").catch(() => {});
  await backendMongoose.connection.dropCollection("expenses").catch(() => {});
  await backendMongoose.disconnect();
});

beforeEach(async () => {
  // Raw collection driver, bypassing Mongoose middleware entirely -- this is
  // fixture cleanup, not the thing under test (see the file-level FINDING
  // comment: the real Category.deleteMany() currently throws on every branch).
  await Category.collection.deleteMany({});
  await Expense.collection.deleteMany({});
});

/** Seed a fixture category via insertMany (bypasses the broken 'save' hook
 *  entirely) -- used for every category that is NOT itself the document
 *  under test in a given case. */
async function seedCategory(fields: Record<string, any>) {
  const [doc] = await categoryRepository.createManyCategories([fields]);
  return doc;
}
const seedOther = (owner: any) => seedCategory({ name: "Other", owner, parent: null, isProtected: true });

describe("models/categoryModel.js hooks", () => {
  it("CH-01 pre(save) rejects isProtected:true on anything but Other", async () => {
    const owner = oid();
    await expect(new Category({ name: "Fake Other", owner, isProtected: true }).save()).rejects.toThrow(/protected/i);
  });

  it("CH-02 pre(save) rejects a parent that does not exist", async () => {
    const owner = oid();
    await expect(new Category({ name: "Sub", owner, parent: oid() }).save()).rejects.toThrow(/Parent category does not exist/);
  });

  it("CH-03 pre(save) rejects a parent that is itself a subcategory (blocks 3 levels)", async () => {
    const owner = oid();
    const a = await seedCategory({ name: "A", owner, parent: null });
    const b = await seedCategory({ name: "B", owner, parent: a._id });
    await expect(new Category({ name: "C", owner, parent: b._id }).save()).rejects.toThrow(
      /cannot have a parent that is itself a subcategory/
    );
  });

  it("CH-04 pre(save) allows a valid main category", async () => {
    const owner = oid();
    const doc = await new Category({ name: "Main", owner }).save();
    expect(doc.parent).toBeFalsy();
  });

  it("CH-05 pre(save) allows a valid subcategory", async () => {
    const owner = oid();
    const a = await seedCategory({ name: "A", owner, parent: null });
    const doc = await new Category({ name: "Sub", owner, parent: a._id }).save();
    expect(String(doc.parent)).toBe(String(a._id));
  });

  it("CH-06 pre(findOneAndUpdate) blocks renaming a protected category", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    await expect(Category.findOneAndUpdate({ _id: other._id }, { name: "Renamed" })).rejects.toThrow(/cannot be renamed/);
  });

  it("CH-07 pre(findOneAndUpdate) blocks unprotecting a protected category", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    await expect(Category.findOneAndUpdate({ _id: other._id }, { isProtected: false })).rejects.toThrow(/cannot be unprotected/);
  });

  it("CH-08 pre(findOneAndUpdate) blocks setting a nonexistent parent", async () => {
    const owner = oid();
    const c = await seedCategory({ name: "Plain", owner, parent: null });
    await expect(Category.findOneAndUpdate({ _id: c._id }, { parent: oid() })).rejects.toThrow(/Parent category does not exist/);
  });

  it("CH-09 pre(findOneAndUpdate) blocks setting a parent that is itself a subcategory", async () => {
    const owner = oid();
    const a = await seedCategory({ name: "A", owner, parent: null });
    const b = await seedCategory({ name: "B", owner, parent: a._id });
    const c = await seedCategory({ name: "C", owner, parent: null });
    await expect(Category.findOneAndUpdate({ _id: c._id }, { parent: b._id })).rejects.toThrow(
      /cannot have a parent that is itself a subcategory/
    );
  });

  it("CH-10 pre(findOneAndUpdate) allows a normal rename of a non-protected category", async () => {
    const owner = oid();
    const c = await seedCategory({ name: "Old", owner, parent: null });
    const updated = await Category.findOneAndUpdate({ _id: c._id }, { name: "New Name" }, { new: true });
    expect(updated.name).toBe("New Name");
  });

  it("CH-11 pre(findOneAndDelete) rejects deleting a protected category", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    await expect(Category.findOneAndDelete({ _id: other._id })).rejects.toThrow(/cannot be deleted/);
  });

  it("CH-12 pre(findOneAndDelete) on a subcategory reassigns its expenses to Other before deleting", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    const a = await seedCategory({ name: "A", owner, parent: null });
    const b = await seedCategory({ name: "B", owner, parent: a._id });
    const exp = await Expense.create({ amount: 10, category: b._id, user: owner });

    await Category.findOneAndDelete({ _id: b._id });

    const reread = await Expense.findById(exp._id);
    expect(String(reread!.category)).toBe(String(other._id));
    expect(await Category.findById(b._id)).toBeNull();
  });

  it("CH-13 pre(findOneAndDelete) on a main category reassigns own + subs' expenses, deletes subs too", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    const a = await seedCategory({ name: "A", owner, parent: null });
    const b1 = await seedCategory({ name: "B1", owner, parent: a._id });
    const b2 = await seedCategory({ name: "B2", owner, parent: a._id });
    const expA = await Expense.create({ amount: 1, category: a._id, user: owner });
    const expB1 = await Expense.create({ amount: 2, category: b1._id, user: owner });
    const expB2 = await Expense.create({ amount: 3, category: b2._id, user: owner });

    await Category.findOneAndDelete({ _id: a._id });

    for (const id of [expA._id, expB1._id, expB2._id]) {
      const reread = await Expense.findById(id);
      expect(String(reread!.category)).toBe(String(other._id));
    }
    expect(await Category.findById(a._id)).toBeNull();
    expect(await Category.findById(b1._id)).toBeNull();
    expect(await Category.findById(b2._id)).toBeNull();
  });

  it("CH-14 pre(deleteMany) rejects a filter that would remove a protected category", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    const plain = await seedCategory({ name: "Plain", owner, parent: null });

    await expect(Category.deleteMany({ _id: { $in: [other._id, plain._id] } })).rejects.toThrow(/Protected categories cannot be deleted/);
    expect(await Category.findById(other._id)).toBeTruthy();
    expect(await Category.findById(plain._id)).toBeTruthy();
  });

  it("CH-15 pre(deleteMany) allows a filter matching only unprotected categories", async () => {
    const owner = oid();
    const other = await seedOther(owner);
    await seedCategory({ name: "P1", owner, parent: null });
    await seedCategory({ name: "P2", owner, parent: null });

    await Category.deleteMany({ owner, isProtected: false });

    expect(await Category.countDocuments({ owner })).toBe(1);
    expect(await Category.findById(other._id)).toBeTruthy();
  });

  it("CH-16 pre(deleteMany) lets the single-key {owner} reset filter through even though it matches Other", async () => {
    const owner = oid();
    await seedOther(owner);
    await seedCategory({ name: "P1", owner, parent: null });
    await seedCategory({ name: "P2", owner, parent: null });

    await Category.deleteMany({ owner });

    expect(await Category.countDocuments({ owner })).toBe(0);
  });
});

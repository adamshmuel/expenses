/**
 * Integration tests for dal/categoryRepository.js + dal/expenseRepository.js additions.
 * Test spec: qa/specs/int-expenseCategoryDal.md  (DL-01 .. DL-10)
 * Governing spec: docs/specs/08-expense-category-dal.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
let expenseRepository: any;
const oid = () => new backendMongoose.Types.ObjectId();

beforeAll(async () => {
  if (backendMongoose.connection.readyState !== 1) {
    const be = readBackendEnv();
    await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  }
  Category = rb("./models/categoryModel.js");
  Expense = rb("./models/expenseModel.js");
  categoryRepository = rb("./dal/categoryRepository.js");
  expenseRepository = rb("./dal/expenseRepository.js");
});

afterAll(async () => {
  await backendMongoose.connection.dropCollection("categories").catch(() => {});
  await backendMongoose.connection.dropCollection("expenses").catch(() => {});
});

describe("dal/categoryRepository.js additions", () => {
  it("DL-01 findOtherCategory finds the seeded Other; null if absent", async () => {
    const owner = oid();
    // Seeded via insertMany (createManyCategories), not .save() -- sidesteps
    // the categoryModel.js pre('save') hook bug found by CH-* (see
    // qa/specs/int-categoryModel.md) so this unrelated DAL test isn't blocked by it.
    const [other] = await categoryRepository.createManyCategories([{ name: "Other", owner, parent: null }]);
    const found = await categoryRepository.findOtherCategory(owner);
    expect(String(found._id)).toBe(String(other._id));

    const stranger = oid();
    expect(await categoryRepository.findOtherCategory(stranger)).toBeNull();
  });

  it("DL-02 createManyCategories bulk-inserts, parent refs round-trip", async () => {
    const owner = oid();
    const [a, b] = await categoryRepository.createManyCategories([
      { name: "A", owner, parent: null },
      { name: "B", owner, parent: null },
    ]);
    expect(a._id).toBeTruthy();
    expect(b._id).toBeTruthy();
    const [aSub] = await categoryRepository.createManyCategories([{ name: "A-sub", owner, parent: a._id }]);
    expect(String(aSub.parent)).toBe(String(a._id));
  });

  it("DL-03 deleteCategoriesByUser removes only that user's categories", async () => {
    const x = oid();
    const y = oid();
    await categoryRepository.createManyCategories([
      { name: "X1", owner: x, parent: null },
      { name: "X2", owner: x, parent: null },
    ]);
    await categoryRepository.createManyCategories([{ name: "Y1", owner: y, parent: null }]);

    await categoryRepository.deleteCategoriesByUser(x);

    expect(await Category.countDocuments({ owner: x })).toBe(0);
    expect(await Category.countDocuments({ owner: y })).toBe(1);
  });
});

describe("dal/expenseRepository.js additions", () => {
  it("DL-04 getExpenseTotalByCategory totals are correct per category", async () => {
    const userId = oid();
    const a = oid();
    const b = oid();
    await Expense.create([
      { amount: 10, category: a, user: userId },
      { amount: 15, category: a, user: userId },
      { amount: 7, category: b, user: userId },
    ]);
    const rows = await expenseRepository.getExpenseTotalByCategory(userId);
    const byId = new Map(rows.map((r: any) => [String(r._id), r.total]));
    expect(byId.get(String(a))).toBe(25);
    expect(byId.get(String(b))).toBe(7);
  });

  it("DL-05 getExpenseTotalByCategory narrows correctly by a date range", async () => {
    const userId = oid();
    const cat = oid();
    await Expense.create([
      { amount: 10, category: cat, user: userId, date: new Date("2026-01-01") },
      { amount: 20, category: cat, user: userId, date: new Date("2026-02-01") },
    ]);
    const rows = await expenseRepository.getExpenseTotalByCategory(userId, new Date("2026-02-01"), new Date("2026-02-28"));
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(20);
  });

  it("DL-06 getExpenseTotalByCategory for a user with zero expenses resolves []", async () => {
    const rows = await expenseRepository.getExpenseTotalByCategory(oid());
    expect(rows).toEqual([]);
  });

  it("DL-07 findExpenseById -- match / null", async () => {
    const userId = oid();
    const exp = await Expense.create({ amount: 5, category: oid(), user: userId });
    const found = await expenseRepository.findExpenseById(exp._id);
    expect(String(found._id)).toBe(String(exp._id));
    expect(await expenseRepository.findExpenseById(oid())).toBeNull();
  });

  it("DL-08 reassignExpensesToCategory moves every one of a user's expenses, and only that user's", async () => {
    const x = oid();
    const y = oid();
    const a = oid();
    const b = oid();
    const [x1, x2] = await Expense.create([
      { amount: 1, category: a, user: x },
      { amount: 2, category: a, user: x },
    ]);
    const [y1] = await Expense.create([{ amount: 3, category: a, user: y }]);

    await expenseRepository.reassignExpensesToCategory(x, b);

    expect(String((await Expense.findById(x1._id))!.category)).toBe(String(b));
    expect(String((await Expense.findById(x2._id))!.category)).toBe(String(b));
    expect(String((await Expense.findById(y1._id))!.category)).toBe(String(a));
  });

  it("DL-09 queryExpenses text filter matches store/description, partial + case-insensitive", async () => {
    const userId = oid();
    await Expense.create([
      { amount: 5, category: oid(), user: userId, store: "Aroma Coffee" },
      { amount: 6, category: oid(), user: userId, description: "team lunch" },
      { amount: 7, category: oid(), user: userId, store: "Hardware Store" },
    ]);
    const coffee = await expenseRepository.queryExpenses(userId, { text: "coffee" });
    expect(coffee).toHaveLength(1);
    expect(coffee[0].store).toBe("Aroma Coffee");

    const lunch = await expenseRepository.queryExpenses(userId, { text: "LUNCH" });
    expect(lunch).toHaveLength(1);
    expect(lunch[0].description).toBe("team lunch");
  });

  it("DL-10 queryExpenses text and date-range filters combine (both narrow)", async () => {
    const userId = oid();
    await Expense.create([
      { amount: 1, category: oid(), user: userId, store: "Coffee Shop", date: new Date("2026-01-05") },
      { amount: 2, category: oid(), user: userId, store: "Coffee Shop", date: new Date("2026-03-05") },
      { amount: 3, category: oid(), user: userId, store: "Other Store", date: new Date("2026-01-05") },
    ]);
    const rows = await expenseRepository.queryExpenses(userId, {
      text: "coffee",
      from: new Date("2026-01-01"),
      to: new Date("2026-01-31"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1);
  });
});

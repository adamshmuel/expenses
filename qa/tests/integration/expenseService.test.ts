/**
 * Integration tests for bl/expenseService.js -- createManyExpenses.
 * Test spec: qa/specs/int-expenseService.md  (EI-01 .. EI-02)
 * Governing spec: docs/specs/09-expense-category-service.md §3.
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

let Expense: any;
let categoryRepository: any;
let expenseService: any;
const oid = () => new backendMongoose.Types.ObjectId();

beforeAll(async () => {
  if (backendMongoose.connection.readyState !== 1) {
    const be = readBackendEnv();
    await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  }
  rb("./models/categoryModel.js");
  Expense = rb("./models/expenseModel.js");
  // Fixture categories are seeded via createManyCategories (insertMany), which
  // does not trigger Mongoose 'save' middleware -- deliberately bypassing the
  // categoryModel.js pre('save') hook bug found by qa/tests/integration/
  // categoryModel.test.ts (CH-*), so that bug doesn't block these otherwise-
  // unrelated expenseService fixtures. See qa/specs/int-categoryModel.md.
  categoryRepository = rb("./dal/categoryRepository.js");
  expenseService = rb("./bl/expenseService.js");
});

afterAll(async () => {
  await backendMongoose.connection.dropCollection("categories").catch(() => {});
  await backendMongoose.connection.dropCollection("expenses").catch(() => {});
});

describe("bl/expenseService.js -- createManyExpenses (integration)", () => {
  it("EI-01 a batch where every draft's category resolves saves all of them", async () => {
    const userId = oid();
    await categoryRepository.createManyCategories([{ name: "Food", owner: userId, parent: null }]);
    const saved = await expenseService.createManyExpenses(userId, [
      { amount: 10, category: "Food" },
      { amount: 20, category: "Food" },
    ]);
    expect(saved).toHaveLength(2);
    expect(await Expense.countDocuments({ user: userId })).toBe(2);
  });

  it("EI-02 one bad category name in a batch fails the whole batch -- no partial save", async () => {
    const userId = oid();
    await categoryRepository.createManyCategories([{ name: "Food", owner: userId, parent: null }]);
    let err: any;
    try {
      await expenseService.createManyExpenses(userId, [
        { amount: 10, category: "Food" },
        { amount: 20, category: "Ghost" },
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: 'No category named "Ghost". Create it first?' });
    expect(await Expense.countDocuments({ user: userId })).toBe(0);
  });
});

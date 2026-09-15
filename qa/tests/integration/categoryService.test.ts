/**
 * Integration tests for bl/categoryService.js (seedDefaultCategories, resetToDefaults)
 * Test spec: qa/specs/int-categoryService.md  (CI-01 .. CI-04)
 * Governing spec: docs/specs/09-expense-category-service.md §2; 04-data-model.md "Category".
 *
 * Real Mongo, real DAL, real models -- not mocked. Connects backend's own
 * mongoose singleton, same approach as tests/integration/categoryModel.test.ts.
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
let categoryService: any;
const oid = () => new backendMongoose.Types.ObjectId();

beforeAll(async () => {
  if (backendMongoose.connection.readyState !== 1) {
    const be = readBackendEnv();
    await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  }
  Category = rb("./models/categoryModel.js");
  Expense = rb("./models/expenseModel.js");
  categoryService = rb("./bl/categoryService.js");
});

afterAll(async () => {
  await backendMongoose.connection.dropCollection("categories").catch(() => {});
  await backendMongoose.connection.dropCollection("expenses").catch(() => {});
});

const MAIN_NAMES = ["Food", "Transport", "Home", "Health", "Clothing", "Entertainment", "Education", "Other"];

describe("bl/categoryService.js (integration)", () => {
  it("CI-01 seedDefaultCategories produces 8 mains with the right sub counts", async () => {
    const userId = oid();
    const created = await categoryService.seedDefaultCategories(userId);
    expect(created).toHaveLength(17);
    const mains = created.filter((c: any) => !c.parent);
    expect(mains).toHaveLength(8);
    expect(mains.map((m: any) => m.name).sort()).toEqual([...MAIN_NAMES].sort());

    const byName = new Map(mains.map((m: any) => [m.name, m]));
    const subsOf = (name: string) => created.filter((c: any) => c.parent && String(c.parent) === String(byName.get(name)._id));
    expect(subsOf("Food").map((s: any) => s.name).sort()).toEqual(["Coffee", "Groceries", "Restaurants"]);
    expect(subsOf("Transport").map((s: any) => s.name).sort()).toEqual(["Fuel", "Parking", "Public transport"]);
    expect(subsOf("Home").map((s: any) => s.name).sort()).toEqual(["Internet", "Rent", "Utilities"]);
    for (const leaf of ["Health", "Clothing", "Entertainment", "Education", "Other"]) {
      expect(subsOf(leaf)).toHaveLength(0);
    }
  });

  it("CI-02 'Other' comes out isProtected:true; every other main does not", async () => {
    const userId = oid();
    const created = await categoryService.seedDefaultCategories(userId);
    const other = created.find((c: any) => c.name === "Other");
    const food = created.find((c: any) => c.name === "Food");
    expect(other.isProtected).toBe(true);
    expect(food.isProtected).toBe(false);
  });

  it("CI-03 resetToDefaults reassigns every expense to the NEW Other before wiping categories", async () => {
    const userId = oid();
    const first = await categoryService.seedDefaultCategories(userId);
    const oldOther = first.find((c: any) => c.name === "Other");
    const oldFood = first.find((c: any) => c.name === "Food");

    const expOnFood = await Expense.create({ amount: 10, category: oldFood._id, user: userId });
    const expOnOther = await Expense.create({ amount: 5, category: oldOther._id, user: userId });

    const reset = await categoryService.resetToDefaults(userId);
    const newOther = reset.find((c: any) => c.name === "Other");
    expect(String(newOther._id)).not.toBe(String(oldOther._id));

    const rereadFood = await Expense.findById(expOnFood._id);
    const rereadOther = await Expense.findById(expOnOther._id);
    expect(String(rereadFood!.category)).toBe(String(newOther._id));
    expect(String(rereadOther!.category)).toBe(String(newOther._id));
    expect(await Category.findById(oldOther._id)).toBeNull();
  });

  it("CI-04 resetToDefaults leaves no orphaned category ids and matches seedDefaultCategories's shape", async () => {
    const userId = oid();
    await categoryService.seedDefaultCategories(userId);
    await categoryService.resetToDefaults(userId);

    const remaining = await Category.find({ owner: userId });
    expect(remaining).toHaveLength(17);
    const mains = remaining.filter((c: any) => !c.parent);
    expect(mains).toHaveLength(8);
  });
});

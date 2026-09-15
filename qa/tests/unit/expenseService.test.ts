/**
 * Unit tests for backend/bl/expenseService.js
 * Test spec: qa/specs/unit-expenseService.md  (ES-01 .. ES-09)
 * Governing spec: docs/specs/09-expense-category-service.md §3.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");

const expenseRepo = {
  createExpense: vi.fn(),
  createManyExpenses: vi.fn(),
  queryExpenses: vi.fn(),
  getExpenseTotalByCategory: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  findExpenseById: vi.fn(),
  reassignExpensesToCategory: vi.fn(),
};
const categoryService = {
  findByName: vi.fn(),
  getForUser: vi.fn(),
};

let expenseService: any;

beforeEach(() => {
  Object.values(expenseRepo).forEach((f) => f.mockReset());
  Object.values(categoryService).forEach((f) => f.mockReset());
  expenseService = loadCjsWithStubs(BACKEND, "./bl/expenseService.js", {
    "../dal/expenseRepository.js": expenseRepo,
    "./categoryService.js": categoryService,
  });
});

const owned = (id: string, userId: string) => ({ _id: id, user: { toString: () => userId } });

describe("bl/expenseService.js", () => {
  it("ES-01 resolveCategory (via createExpense): zero matches -> 400", async () => {
    categoryService.findByName.mockResolvedValue([]);
    let err: any;
    try {
      await expenseService.createExpense("u1", { amount: 10, category: "Ghost" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: 'No category named "Ghost". Create it first?' });
    expect(expenseRepo.createExpense).not.toHaveBeenCalled();
  });

  it("ES-02 resolveCategory: more than one match -> 400 with candidates", async () => {
    const candidates = [{ _id: "c1", name: "Coffee" }, { _id: "c2", name: "Coffee" }];
    categoryService.findByName.mockResolvedValue(candidates);
    let err: any;
    try {
      await expenseService.createExpense("u1", { amount: 10, category: "Coffee" });
    } catch (e) {
      err = e;
    }
    expect(err.status).toBe(400);
    expect(err.message).toBe('More than one category matches "Coffee".');
    expect(err.candidates).toEqual(candidates);
  });

  it("ES-03 createExpense resolves the category name to an id before saving", async () => {
    categoryService.findByName.mockResolvedValue([{ _id: "cat1" }]);
    expenseRepo.createExpense.mockResolvedValue({ _id: "e1" });
    await expenseService.createExpense("u1", { amount: 12, store: "Aroma", category: "Coffee" });
    expect(expenseRepo.createExpense).toHaveBeenCalledWith({
      amount: 12,
      store: "Aroma",
      description: undefined,
      date: undefined,
      category: "cat1",
      user: "u1",
    });
  });

  it("ES-04 editExpense on a missing or foreign expense -> 404", async () => {
    expenseRepo.findExpenseById.mockResolvedValue(null);
    let errA: any;
    try {
      await expenseService.editExpense("u1", "e1", { amount: 20 });
    } catch (e) {
      errA = e;
    }
    expect(errA).toEqual({ status: 404, message: "Expense not found." });

    expenseRepo.findExpenseById.mockResolvedValue(owned("e1", "someone-else"));
    let errB: any;
    try {
      await expenseService.editExpense("u1", "e1", { amount: 20 });
    } catch (e) {
      errB = e;
    }
    expect(errB).toEqual({ status: 404, message: "Expense not found." });
    expect(expenseRepo.updateExpense).not.toHaveBeenCalled();
  });

  it("ES-05 editExpense resolves changes.category to an id when present", async () => {
    expenseRepo.findExpenseById.mockResolvedValue(owned("e1", "u1"));
    categoryService.findByName.mockResolvedValue([{ _id: "cat2" }]);
    expenseRepo.updateExpense.mockResolvedValue({ _id: "e1" });
    await expenseService.editExpense("u1", "e1", { category: "Entertainment" });
    expect(expenseRepo.updateExpense).toHaveBeenCalledWith("e1", { category: "cat2" });
  });

  it("ES-06 editExpense with no changes.category passes changes through untouched", async () => {
    expenseRepo.findExpenseById.mockResolvedValue(owned("e1", "u1"));
    expenseRepo.updateExpense.mockResolvedValue({ _id: "e1" });
    await expenseService.editExpense("u1", "e1", { amount: 30 });
    expect(categoryService.findByName).not.toHaveBeenCalled();
    expect(expenseRepo.updateExpense).toHaveBeenCalledWith("e1", { amount: 30 });
  });

  it("ES-07 deleteExpense on a missing or foreign expense -> 404", async () => {
    expenseRepo.findExpenseById.mockResolvedValue(null);
    let errA: any;
    try {
      await expenseService.deleteExpense("u1", "e1");
    } catch (e) {
      errA = e;
    }
    expect(errA).toEqual({ status: 404, message: "Expense not found." });

    expenseRepo.findExpenseById.mockResolvedValue(owned("e1", "someone-else"));
    let errB: any;
    try {
      await expenseService.deleteExpense("u1", "e1");
    } catch (e) {
      errB = e;
    }
    expect(errB).toEqual({ status: 404, message: "Expense not found." });
  });

  it("ES-08 deleteExpense happy path delegates to the repository", async () => {
    expenseRepo.findExpenseById.mockResolvedValue(owned("e1", "u1"));
    expenseRepo.deleteExpense.mockResolvedValue({ _id: "e1" });
    await expenseService.deleteExpense("u1", "e1");
    expect(expenseRepo.deleteExpense).toHaveBeenCalledWith("e1");
  });

  it("ES-09 getForUser is a rule-free passthrough of filters", async () => {
    expenseRepo.queryExpenses.mockResolvedValue([]);
    await expenseService.getForUser("u1", { from: "2026-01-01", text: "coffee" });
    expect(expenseRepo.queryExpenses).toHaveBeenCalledWith("u1", { from: "2026-01-01", text: "coffee" });
  });
});

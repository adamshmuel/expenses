/**
 * Unit tests for backend/bl/categoryService.js
 * Test spec: qa/specs/unit-categoryService.md  (CS-01 .. CS-13)
 * Governing spec: docs/specs/09-expense-category-service.md §2.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");

const repo = {
  getCategoriesByUser: vi.fn(),
  findCategoryById: vi.fn(),
  findOtherCategory: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createManyCategories: vi.fn(),
  deleteCategoriesByUser: vi.fn(),
};
const expenseRepo = {
  reassignExpensesToCategory: vi.fn(),
};

let categoryService: any;

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  Object.values(expenseRepo).forEach((f) => f.mockReset());
  categoryService = loadCjsWithStubs(BACKEND, "./bl/categoryService.js", {
    "../dal/categoryRepository.js": repo,
    "../dal/expenseRepository.js": expenseRepo,
  });
});

describe("bl/categoryService.js", () => {
  it("CS-01 findByName matches case-insensitively", async () => {
    repo.getCategoriesByUser.mockResolvedValue([{ _id: "c1", name: "Fuel", parent: null }]);
    const out = await categoryService.findByName("u1", "fuel");
    expect(out).toHaveLength(1);
    expect(out[0]._id).toBe("c1");
  });

  it("CS-02 findByName scopes by parent when given", async () => {
    repo.getCategoriesByUser.mockResolvedValue([
      { _id: "s1", name: "Coffee", parent: "p1" },
      { _id: "s2", name: "Coffee", parent: "p2" },
    ]);
    const out = await categoryService.findByName("u1", "coffee", "p1");
    expect(out.map((c: any) => c._id)).toEqual(["s1"]);
  });

  it("CS-03 findByName returns zero, one, or several matches", async () => {
    repo.getCategoriesByUser.mockResolvedValue([]);
    expect(await categoryService.findByName("u1", "x")).toHaveLength(0);
    repo.getCategoriesByUser.mockResolvedValue([{ _id: "c1", name: "X", parent: null }]);
    expect(await categoryService.findByName("u1", "x")).toHaveLength(1);
    repo.getCategoriesByUser.mockResolvedValue([
      { _id: "c1", name: "X", parent: null },
      { _id: "c2", name: "X", parent: null },
    ]);
    expect(await categoryService.findByName("u1", "x")).toHaveLength(2);
  });

  it("CS-04 createCategory with no parent creates a main category", async () => {
    repo.getCategoriesByUser.mockResolvedValue([]);
    repo.createCategory.mockResolvedValue({ _id: "new", name: "Pets", parent: null, owner: "u1" });
    await categoryService.createCategory("u1", { name: "Pets" });
    expect(repo.createCategory).toHaveBeenCalledWith({ name: "Pets", parent: null, owner: "u1" });
  });

  it("CS-05 createCategory with a nonexistent parent -> 400", async () => {
    // Corrected 2026-09-16: createCategory now resolves `parent` by NAME via
    // findByName -> getCategoriesByUser (bug 9's fix -- the old mock here was
    // findCategoryById, matching a by-id resolution the code no longer does).
    repo.getCategoriesByUser.mockResolvedValue([]);
    let err: any;
    try {
      await categoryService.createCategory("u1", { name: "Pets", parent: "ghost" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: "No such category to add a subcategory to." });
    expect(repo.createCategory).not.toHaveBeenCalled();
  });

  it("CS-06 createCategory with an ambiguous parent name (2+ matches) -> 400", async () => {
    // Replaces the old "parent owned by another user" case, which the
    // current implementation can no longer reach -- findByName's search is
    // already scoped to this user's own categories via getCategoriesByUser
    // (userId), so a foreign owner is never a candidate. This is the
    // multi-match branch of createCategory's own parent resolution, distinct
    // from resolveCategory's equivalent branch for expenses (see
    // qa/specs/api-chat-confirm-resolution.md CR-04) -- untested until now.
    repo.getCategoriesByUser.mockResolvedValue([
      { _id: "p1", name: "p1", owner: "u1", parent: null },
      { _id: "p2", name: "p1", owner: "u1", parent: null },
    ]);
    let err: any;
    try {
      await categoryService.createCategory("u1", { name: "Pets", parent: "p1" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: 'More than one category named "p1".' });
    expect(repo.createCategory).not.toHaveBeenCalled();
  });

  it("CS-07 createCategory with a parent that is itself a subcategory -> 400 (two-level rule)", async () => {
    repo.getCategoriesByUser.mockResolvedValue([{ _id: "p1", name: "p1", owner: "u1", parent: "grandparent" }]);
    let err: any;
    try {
      await categoryService.createCategory("u1", { name: "X", parent: "p1" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: "Categories can only be two levels deep." });
  });

  it("CS-08 createCategory duplicate name under the same parent -> 409", async () => {
    repo.getCategoriesByUser.mockResolvedValue([{ _id: "c1", name: "Pets", parent: null }]);
    let err: any;
    try {
      await categoryService.createCategory("u1", { name: "Pets" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 409, message: 'A category named "Pets" already exists here.' });
    expect(repo.createCategory).not.toHaveBeenCalled();
  });

  it("CS-09 updateCategory on a missing or foreign category -> 404", async () => {
    repo.findCategoryById.mockResolvedValue(null);
    let errA: any;
    try {
      await categoryService.updateCategory("u1", "c1", { name: "New" });
    } catch (e) {
      errA = e;
    }
    expect(errA).toEqual({ status: 404, message: "Category not found." });

    repo.findCategoryById.mockResolvedValue({ _id: "c1", owner: "someone-else" });
    let errB: any;
    try {
      await categoryService.updateCategory("u1", "c1", { name: "New" });
    } catch (e) {
      errB = e;
    }
    expect(errB).toEqual({ status: 404, message: "Category not found." });
  });

  it("CS-10 updateCategory on isProtected -> 400", async () => {
    repo.findCategoryById.mockResolvedValue({ _id: "c1", owner: "u1", isProtected: true });
    let err: any;
    try {
      await categoryService.updateCategory("u1", "c1", { name: "Renamed" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 400, message: '"Other" cannot be renamed.' });
  });

  it("CS-11 updateCategory duplicate name under the same parent (excluding self) -> 409", async () => {
    repo.findCategoryById.mockResolvedValue({ _id: "c1", owner: "u1", parent: null, isProtected: false });
    repo.getCategoriesByUser.mockResolvedValue([
      { _id: "c1", name: "Pets", parent: null },
      { _id: "c2", name: "Pets", parent: null },
    ]);
    let err: any;
    try {
      await categoryService.updateCategory("u1", "c1", { name: "Pets" });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 409, message: 'A category named "Pets" already exists here.' });
  });

  it("CS-12 updateCategory renaming to its own current name does NOT 409 (self-exclusion)", async () => {
    repo.findCategoryById.mockResolvedValue({ _id: "c1", owner: "u1", parent: null, isProtected: false });
    repo.getCategoriesByUser.mockResolvedValue([{ _id: "c1", name: "Pets", parent: null }]);
    repo.updateCategory.mockResolvedValue({ _id: "c1", name: "Pets" });
    await categoryService.updateCategory("u1", "c1", { name: "Pets" });
    expect(repo.updateCategory).toHaveBeenCalledWith("c1", { name: "Pets" });
  });

  it("CS-13 deleteCategory: 404 missing/foreign, 400 protected, happy path delegates", async () => {
    repo.findCategoryById.mockResolvedValue(null);
    let errA: any;
    try {
      await categoryService.deleteCategory("u1", "c1");
    } catch (e) {
      errA = e;
    }
    expect(errA).toEqual({ status: 404, message: "Category not found." });

    repo.findCategoryById.mockResolvedValue({ owner: "someone-else" });
    let errB: any;
    try {
      await categoryService.deleteCategory("u1", "c1");
    } catch (e) {
      errB = e;
    }
    expect(errB).toEqual({ status: 404, message: "Category not found." });

    repo.findCategoryById.mockResolvedValue({ owner: "u1", isProtected: true });
    let errC: any;
    try {
      await categoryService.deleteCategory("u1", "c1");
    } catch (e) {
      errC = e;
    }
    expect(errC).toEqual({ status: 400, message: '"Other" cannot be deleted.' });

    repo.findCategoryById.mockResolvedValue({ owner: "u1", isProtected: false });
    repo.deleteCategory.mockResolvedValue({ _id: "c1" });
    await categoryService.deleteCategory("u1", "c1");
    expect(repo.deleteCategory).toHaveBeenCalledWith("c1");
  });
});

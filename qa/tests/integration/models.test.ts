/**
 * Integration tests for backend/models/*.js
 * Test spec: qa/specs/int-models.md  (MD-01 .. MD-20)
 * Governing spec: docs/specs/04-data-model.md.
 *
 * Uses a QA-owned mongoose connection to the TEST database. Validation-only
 * cases use new Model(doc).validate() (no write). Index cases call Model.init()
 * then read the collection indexes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");

let conn: mongoose.Connection;
let User: mongoose.Model<any>;
let RefreshToken: mongoose.Model<any>;
let Expense: mongoose.Model<any>;
const oid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  const be = readBackendEnv();
  conn = await mongoose.createConnection(deriveTestMongoUri(be.MONGODB_URI)).asPromise();
  // The model files call mongoose.model(...) on the default global mongoose.
  // Register them there, then also compile onto our connection for index build.
  const userSchema = requireSchema("userModel.js");
  const rtSchema = requireSchema("refreshTokenModel.js");
  const expSchema = requireSchema("expenseModel.js");
  User = conn.model("User", userSchema);
  RefreshToken = conn.model("RefreshToken", rtSchema);
  Expense = conn.model("Expense", expSchema);
  await Promise.all([User.init(), RefreshToken.init(), Expense.init()]);
});

afterAll(async () => {
  await conn?.dropCollection("users").catch(() => {});
  await conn?.dropCollection("refreshtokens").catch(() => {});
  await conn?.dropCollection("expenses").catch(() => {});
  await conn?.close();
});

/** Load a model file's schema without binding it to the global mongoose model registry twice. */
function requireSchema(file: string): mongoose.Schema {
  const { createRequire } = require("node:module") as typeof import("node:module");
  const rb = createRequire(resolve(BACKEND, "package.json"));
  const key = rb.resolve(`./models/${file}`);
  delete rb.cache[key];
  const model = rb(`./models/${file}`) as mongoose.Model<any>;
  return model.schema;
}

async function expectValidationError(doc: any, path: string) {
  const err: any = await doc.validate().then(() => null).catch((e: any) => e);
  expect(err, `expected a validation error on "${path}"`).toBeTruthy();
  expect(err.errors[path], `expected err.errors.${path}`).toBeTruthy();
  return err;
}

describe("models/userModel.js", () => {
  it("MD-01 username is required", async () => {
    const e = await expectValidationError(new User({ email: "a@x.io", password: "h" }), "username");
    expect(e.errors.username.kind).toBe("required");
  });
  it("MD-02 username shorter than 3 is rejected", async () => {
    const e = await expectValidationError(new User({ username: "ab", email: "a@x.io", password: "h" }), "username");
    expect(e.errors.username.message).toMatch(/3 characters/i);
  });
  it("MD-03 username longer than 20 is rejected", async () => {
    const e = await expectValidationError(new User({ username: "x".repeat(21), email: "a@x.io", password: "h" }), "username");
    expect(e.errors.username.message).toMatch(/20/);
  });
  it("MD-04 username is trimmed", () => {
    expect(new User({ username: "  amir  ", email: "a@x.io", password: "h" }).username).toBe("amir");
  });
  it("MD-05 email must pass validator.isEmail", async () => {
    const e = await expectValidationError(new User({ username: "amir", email: "not-an-email", password: "h" }), "email");
    expect(e.errors.email.message).toBe("Please enter a valid email address");
  });
  it("MD-06 email is lowercased", () => {
    expect(new User({ username: "amir", email: "Amir@Example.IO", password: "h" }).email).toBe("amir@example.io");
  });
  it("MD-07 username and email have unique indexes", async () => {
    const idx = await User.collection.getIndexes({ full: true } as any) as any[];
    const byKey = (k: string) => idx.find((i) => JSON.stringify(i.key) === JSON.stringify({ [k]: 1 }));
    expect(byKey("username")?.unique).toBe(true);
    expect(byKey("email")?.unique).toBe(true);
  });
  it("MD-08 createdAt defaults to ~now; toJSON exposes the id virtual", async () => {
    const u = new User({ username: `md08_${Date.now()}`.slice(0, 20), email: `md08_${Date.now()}@x.io`, password: "h" });
    expect(u.createdAt instanceof Date).toBe(true);
    expect(Math.abs(Date.now() - u.createdAt.getTime())).toBeLessThan(5000);
    await u.save();
    const j = u.toJSON();
    expect(typeof j.id).toBe("string");
    expect(j.id).toBe(u._id.toString());
    await User.deleteOne({ _id: u._id });
  });
});

describe("models/refreshTokenModel.js", () => {
  it("MD-09 token is required", async () => {
    const e = await expectValidationError(new RefreshToken({ user: oid(), expiresAt: new Date() }), "token");
    expect(e.errors.token.kind).toBe("required");
  });
  it("MD-10 user is required and is an ObjectId ref to User", async () => {
    await expectValidationError(new RefreshToken({ token: "t", expiresAt: new Date() }), "user");
    await expectValidationError(new RefreshToken({ token: "t", user: "not-an-oid", expiresAt: new Date() }), "user");
    expect(RefreshToken.schema.path("user").options.ref).toBe("User");
  });
  it("MD-11 expiresAt is required", async () => {
    const e = await expectValidationError(new RefreshToken({ token: "t", user: oid() }), "expiresAt");
    expect(e.errors.expiresAt.kind).toBe("required");
  });
  it("MD-12 token has a unique index", async () => {
    const idx = (await RefreshToken.collection.getIndexes({ full: true } as any)) as any[];
    const tok = idx.find((i) => JSON.stringify(i.key) === JSON.stringify({ token: 1 }));
    expect(tok?.unique).toBe(true);
  });
  it("MD-13 TTL index on expiresAt with expireAfterSeconds: 0", async () => {
    const idx = (await RefreshToken.collection.getIndexes({ full: true } as any)) as any[];
    const ttl = idx.find((i) => JSON.stringify(i.key) === JSON.stringify({ expiresAt: 1 }));
    expect(ttl).toBeTruthy();
    expect(ttl.expireAfterSeconds).toBe(0);
  });
  it("MD-14 there is an index on user", async () => {
    const idx = (await RefreshToken.collection.getIndexes({ full: true } as any)) as any[];
    expect(idx.some((i) => JSON.stringify(i.key) === JSON.stringify({ user: 1 }))).toBe(true);
  });
});

describe("models/expenseModel.js", () => {
  it("MD-15 amount is required", async () => {
    const e = await expectValidationError(new Expense({ category: oid(), user: oid() }), "amount");
    expect(e.errors.amount.kind).toBe("required");
  });
  it("MD-16 amount of 0 is rejected", async () => {
    const e = await expectValidationError(new Expense({ amount: 0, category: oid(), user: oid() }), "amount");
    expect(e.errors.amount.message).toMatch(/greater than 0/i);
  });
  it("MD-17 negative amount is rejected", async () => {
    await expectValidationError(new Expense({ amount: -5, category: oid(), user: oid() }), "amount");
  });
  it("MD-18 amount of 0.01 is accepted", async () => {
    await expect(new Expense({ amount: 0.01, category: oid(), user: oid() }).validate()).resolves.toBeUndefined();
  });
  it("MD-19 date defaults to ~now; category and user are required refs", async () => {
    const ok = new Expense({ amount: 5, category: oid(), user: oid() });
    expect(ok.date instanceof Date).toBe(true);
    expect(Math.abs(Date.now() - ok.date.getTime())).toBeLessThan(5000);
    const err: any = await new Expense({ amount: 5 }).validate().then(() => null).catch((e: any) => e);
    expect(err.errors.category).toBeTruthy();
    expect(err.errors.user).toBeTruthy();
    expect(Expense.schema.path("category").options.ref).toBe("Category");
    expect(Expense.schema.path("user").options.ref).toBe("User");
  });
  it("MD-20 compound index { user: 1, date: 1 } exists", async () => {
    const idx = (await Expense.collection.getIndexes({ full: true } as any)) as any[];
    expect(idx.some((i) => JSON.stringify(i.key) === JSON.stringify({ user: 1, date: 1 }))).toBe(true);
  });
});

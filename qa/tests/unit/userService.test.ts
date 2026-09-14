/**
 * Unit tests for backend/bl/userService.js
 * Test spec: qa/specs/unit-userService.md  (US-01 .. US-18)
 * Governing spec: docs/specs/05-user-layers.md §4, §10 decision 1.
 *
 * userService.js is CommonJS and require()s '../dal/userRepository.js', 'bcrypt'
 * and 'jsonwebtoken' at load time. We seed Node's require.cache with stubs for
 * userRepository and bcrypt (see harness/cjs-stub.ts); jsonwebtoken stays REAL
 * so token payloads can be decoded/verified.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jwtReal from "jsonwebtoken";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");

const ACCESS_SECRET = "test-access-secret";
const REFRESH_SECRET = "test-refresh-secret";

const repo = {
  createUser: vi.fn(),
  findUserByUsername: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  saveRefreshToken: vi.fn(),
  findRefreshToken: vi.fn(),
  deleteRefreshToken: vi.fn(),
};
const bcrypt = {
  hash: vi.fn(async (v: string) => `HASHED::${v}`),
  compare: vi.fn(),
};

let userService: any;

beforeEach(() => {
  process.env.JWT_SECRET = ACCESS_SECRET;
  process.env.REFRESH_TOKEN_SECRET = REFRESH_SECRET;
  Object.values(repo).forEach((f) => f.mockReset());
  bcrypt.hash.mockReset().mockImplementation(async (v: string) => `HASHED::${v}`);
  bcrypt.compare.mockReset();
  repo.saveRefreshToken.mockResolvedValue({});
  repo.deleteRefreshToken.mockResolvedValue({ deletedCount: 1 });

  userService = loadCjsWithStubs(BACKEND, "./bl/userService.js", {
    "../dal/userRepository.js": repo,
    bcrypt: bcrypt,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const FAKE_USER = { _id: "u1", username: "amir", email: "a@x.io" };

describe("bl/userService.js", () => {
  it("US-01 signup: access token payload is exactly { id, username } (+iat/exp)", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    const { accessToken } = await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    const payload = jwtReal.decode(accessToken) as any;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "id", "username"]);
    expect(payload.id).toBe("u1");
    expect(payload.username).toBe("amir");
  });

  it("US-02 signup: refresh token payload is exactly { userId } (+iat/exp)", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    const { refreshToken } = await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    const payload = jwtReal.decode(refreshToken) as any;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "userId"]);
    expect(payload.userId).toBe("u1");
  });

  it("US-03 the two tokens verify only under their own secret", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    const { accessToken, refreshToken } = await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    expect(() => jwtReal.verify(accessToken, ACCESS_SECRET)).not.toThrow();
    expect(() => jwtReal.verify(accessToken, REFRESH_SECRET)).toThrow();
    expect(() => jwtReal.verify(refreshToken, REFRESH_SECRET)).not.toThrow();
    expect(() => jwtReal.verify(refreshToken, ACCESS_SECRET)).toThrow();
  });

  it("US-04 access lifetime ~15m, refresh lifetime ~7d", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    const { accessToken, refreshToken } = await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    const a = jwtReal.decode(accessToken) as any;
    const r = jwtReal.decode(refreshToken) as any;
    expect(Math.abs(a.exp - a.iat - 900)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.exp - r.iat - 604800)).toBeLessThanOrEqual(2);
  });

  it("US-05 signup: refresh row saved with expiresAt === now + 7 days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    repo.createUser.mockResolvedValue(FAKE_USER);
    await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    expect(repo.saveRefreshToken).toHaveBeenCalledTimes(1);
    const arg = repo.saveRefreshToken.mock.calls[0][0];
    expect(arg.user).toBe("u1");
    expect(typeof arg.token).toBe("string");
    expect(arg.expiresAt.getTime()).toBe(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it("US-06 signup hashes the password before createUser", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    await userService.signup({ username: "amir", email: "a@x.io", password: "plaintextpw" });
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenCalledWith("plaintextpw", 10);
    expect(repo.createUser).toHaveBeenCalledTimes(1);
    expect(repo.createUser.mock.calls[0][0].password).toBe("HASHED::plaintextpw");
  });

  it("US-07 signup return shape is { user, accessToken, refreshToken }", async () => {
    repo.createUser.mockResolvedValue(FAKE_USER);
    const out = await userService.signup({ username: "amir", email: "a@x.io", password: "password123" });
    expect(Object.keys(out).sort()).toEqual(["accessToken", "refreshToken", "user"]);
    expect(out.user).toBe(FAKE_USER);
    expect(out.accessToken.length).toBeGreaterThan(0);
    expect(out.refreshToken.length).toBeGreaterThan(0);
  });

  it("US-08 signup propagates a repository E11000 throw unchanged", async () => {
    const dup = Object.assign(new Error("E11000 dup key"), { code: 11000 });
    repo.createUser.mockRejectedValue(dup);
    await expect(userService.signup({ username: "amir", email: "a@x.io", password: "password123" })).rejects.toBe(dup);
    expect((dup as any).code).toBe(11000);
    expect(repo.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("US-09 login with correct credentials returns the token pair", async () => {
    repo.findUserByUsername.mockResolvedValue({ ...FAKE_USER, password: "HASHED" });
    bcrypt.compare.mockResolvedValue(true);
    const out = await userService.login("amir", "rightpw");
    expect(Object.keys(out).sort()).toEqual(["accessToken", "refreshToken", "user"]);
    expect(out.user._id).toBe("u1");
    expect(bcrypt.compare).toHaveBeenCalledWith("rightpw", "HASHED");
  });

  it("US-10 unknown user and wrong password throw the SAME 401", async () => {
    repo.findUserByUsername.mockResolvedValue(null);
    let errA: any;
    try { await userService.login("ghost", "x"); } catch (e) { errA = e; }
    expect(errA.status).toBe(401);
    expect(errA.message).toBe("Username or password is incorrect.");
    expect(bcrypt.compare).not.toHaveBeenCalled();

    repo.findUserByUsername.mockResolvedValue({ ...FAKE_USER, password: "HASHED" });
    bcrypt.compare.mockResolvedValue(false);
    let errB: any;
    try { await userService.login("amir", "wrong"); } catch (e) { errB = e; }
    expect(errB.status).toBe(401);
    expect(errB.message).toBe(errA.message);
    expect(repo.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("US-11 refresh happy path: old row deleted, new pair issued, same user", async () => {
    repo.findRefreshToken.mockResolvedValue({ token: "old", user: "u1" });
    repo.findUserById.mockResolvedValue(FAKE_USER);
    // Sign the incoming token 2s in the past so its `iat` differs from the one
    // issueTokenPair will mint now (jwt second-resolution timestamps otherwise
    // collide for an identical payload+secret within the same wall-clock second).
    const past = Math.floor(Date.now() / 1000) - 2;
    const oldToken = jwtReal.sign({ userId: "u1", iat: past }, REFRESH_SECRET, { expiresIn: "7d" });
    const out = await userService.refresh(oldToken);
    expect(Object.keys(out).sort()).toEqual(["accessToken", "refreshToken", "user"]);
    // Rotation: the exact old token is deleted, and a fresh row is saved.
    expect(repo.deleteRefreshToken).toHaveBeenCalledWith(oldToken);
    expect(repo.saveRefreshToken).toHaveBeenCalledTimes(1);
    const savedToken = repo.saveRefreshToken.mock.calls[0][0].token;
    expect(savedToken).toBe(out.refreshToken);
    expect(savedToken).not.toBe(oldToken);
    // And the delete happens before the new row is saved (old row can never be reused).
    const delOrder = repo.deleteRefreshToken.mock.invocationCallOrder[0];
    const saveOrder = repo.saveRefreshToken.mock.invocationCallOrder[0];
    expect(delOrder).toBeLessThan(saveOrder);
    expect(out.user._id).toBe("u1");
  });

  it("US-12 refresh with a token not in the collection -> 401 'not recognized'", async () => {
    repo.findRefreshToken.mockResolvedValue(null);
    let err: any;
    try { await userService.refresh("whatever"); } catch (e) { err = e; }
    expect(err.status).toBe(401);
    expect(err.message).toBe("not recognized");
    expect(repo.findUserById).not.toHaveBeenCalled();
    expect(repo.deleteRefreshToken).not.toHaveBeenCalled();
  });

  it("US-13 refresh propagates a jwt.verify failure and aborts before the delete", async () => {
    repo.findRefreshToken.mockResolvedValue({ token: "row" });
    await expect(userService.refresh("not.a.jwt")).rejects.toBeInstanceOf(Error);
    expect(repo.deleteRefreshToken).not.toHaveBeenCalled();
    expect(repo.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("US-14 the old refresh token cannot be used twice", async () => {
    repo.findRefreshToken.mockResolvedValue({ token: "old", user: "u1" });
    repo.findUserById.mockResolvedValue(FAKE_USER);
    const oldToken = jwtReal.sign({ userId: "u1" }, REFRESH_SECRET, { expiresIn: "7d" });
    await expect(userService.refresh(oldToken)).resolves.toBeTruthy();
    repo.findRefreshToken.mockResolvedValue(null);
    let err: any;
    try { await userService.refresh(oldToken); } catch (e) { err = e; }
    expect(err.status).toBe(401);
    expect(err.message).toBe("not recognized");
  });

  it("US-15 logout deletes the given token", async () => {
    await userService.logout("tok123");
    expect(repo.deleteRefreshToken).toHaveBeenCalledWith("tok123");
  });

  it("US-16 logout with undefined is a safe no-op", async () => {
    await expect(userService.logout(undefined)).resolves.toBeUndefined();
    expect(repo.deleteRefreshToken).toHaveBeenCalledWith(undefined);
  });

  it("US-17 issueTokenPair is not exported", () => {
    expect(Object.keys(userService).sort()).toEqual(["login", "logout", "refresh", "signup"]);
  });

  it("US-18 login issues and stores a refresh row on success", async () => {
    repo.findUserByUsername.mockResolvedValue({ ...FAKE_USER, password: "HASHED" });
    bcrypt.compare.mockResolvedValue(true);
    await userService.login("amir", "rightpw");
    expect(repo.saveRefreshToken).toHaveBeenCalledTimes(1);
    const arg = repo.saveRefreshToken.mock.calls[0][0];
    expect(arg.user).toBe("u1");
    expect(typeof arg.token).toBe("string");
    expect(arg.expiresAt instanceof Date).toBe(true);
  });
});

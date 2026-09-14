import { TEST_BASE_URL } from "../harness/paths.js";

let seq = 0;
/** A deterministic-per-run counter so each test gets its own user. */
function nextId() {
  seq += 1;
  return `${Date.now().toString(36)}_${seq}`;
}

export interface NewUser {
  username: string;
  email: string;
  password: string;
}

export function makeUser(overrides: Partial<NewUser> = {}): NewUser {
  const id = nextId();
  return {
    username: `qa_${id}`.slice(0, 20),
    email: `qa_${id}@test.io`,
    password: "password123",
    ...overrides,
  };
}

export interface SignupResult {
  status: number;
  body: any;
  setCookie: string[];
  refreshCookie: string | null; // "refreshToken=<value>" ready for a Cookie header
  user: NewUser;
}

export async function signup(user: NewUser = makeUser()): Promise<SignupResult> {
  const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  const setCookie = res.headers.getSetCookie?.() ?? readSetCookie(res);
  const body = await safeJson(res);
  return {
    status: res.status,
    body,
    setCookie,
    refreshCookie: extractCookiePair(setCookie, "refreshToken"),
    user,
  };
}

export async function login(username: string, password: string) {
  const res = await fetch(`${TEST_BASE_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? readSetCookie(res);
  return {
    status: res.status,
    body: await safeJson(res),
    setCookie,
    refreshCookie: extractCookiePair(setCookie, "refreshToken"),
    headers: res.headers,
  };
}

/** Sign up a fresh user and return the Cookie-header value for its refresh token. */
export async function signupAndGetCookie(): Promise<{ cookie: string; user: NewUser; body: any }> {
  const r = await signup();
  if (!r.refreshCookie) {
    throw new Error(`signup did not set a refreshToken cookie (status ${r.status}, body ${JSON.stringify(r.body)})`);
  }
  return { cookie: r.refreshCookie, user: r.user, body: r.body };
}

export function readSetCookie(res: Response): string[] {
  const h = res.headers.get("set-cookie");
  return h ? [h] : [];
}

/** From a list of Set-Cookie strings, return "name=value" for the named cookie, or null. */
export function extractCookiePair(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const first = c.split(";")[0];
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    if (first.slice(0, eq).trim() === name) return `${name}=${first.slice(eq + 1).trim()}`;
  }
  return null;
}

/** Parse the attributes of the named Set-Cookie directive into a lowercased map. */
export function parseCookieAttrs(setCookies: string[], name: string): Record<string, string | true> | null {
  for (const c of setCookies) {
    const parts = c.split(";").map((p) => p.trim());
    if (!parts[0].toLowerCase().startsWith(name.toLowerCase() + "=")) continue;
    const attrs: Record<string, string | true> = {};
    attrs["__value"] = parts[0].slice(name.length + 1);
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq === -1) attrs[p.toLowerCase()] = true;
      else attrs[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1);
    }
    return attrs;
  }
  return null;
}

export async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text };
  }
}

const HASH_PREFIXES = ["$2a$", "$2b$", "$2y$"];
export function containsSecret(str: string): { hit: boolean; what?: string } {
  if (/\bpassword\b/i.test(str)) return { hit: true, what: "password" };
  for (const p of HASH_PREFIXES) if (str.includes(p)) return { hit: true, what: `bcrypt hash (${p})` };
  return { hit: false };
}

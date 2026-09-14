import { spawn, ChildProcess, execFileSync } from "node:child_process";
import { BACKEND_DIR, BACKEND_INDEX, TEST_BASE_URL, TEST_PORT } from "./paths.js";
import { readBackendEnv, deriveTestMongoUri } from "./env.js";

let child: ChildProcess | null = null;
let stdoutBuf = "";
let stderrBuf = "";

export function serverOutput() {
  return { stdout: stdoutBuf, stderr: stderrBuf };
}

/** Kill whatever is listening on TEST_PORT, whichever context started it. Fixed port, no user input. */
export function killPort(port = TEST_PORT): void {
  let out = "";
  try {
    out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8", timeout: 5000 });
  } catch {
    out = ""; // lsof exits non-zero when nothing matches, or is unavailable
  }
  for (const pid of out.split(/\s+/).filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Spawn `node backend/index.js` with cwd = backend/ (so its relative ./logs
 * paths resolve), pointed at the TEST database on the TEST port. Waits for the
 * readiness line. Never touches backend/.env.
 */
export async function startServer(overrides: Record<string, string> = {}): Promise<void> {
  killPort();
  await sleep(250);

  const be = readBackendEnv();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(TEST_PORT),
    MONGODB_URI: deriveTestMongoUri(be.MONGODB_URI),
    JWT_SECRET: be.JWT_SECRET,
    REFRESH_TOKEN_SECRET: be.REFRESH_TOKEN_SECRET,
    CLIENT_ORIGIN: be.CLIENT_ORIGIN || "http://localhost:5173",
    ...overrides,
  };

  stdoutBuf = "";
  stderrBuf = "";
  child = spawn(process.execPath, [BACKEND_INDEX], { cwd: BACKEND_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => (stdoutBuf += d.toString()));
  child.stderr!.on("data", (d) => (stderrBuf += d.toString()));

  const deadline = Date.now() + 30_000;
  const wantLine = `Server running on http://localhost:${TEST_PORT}`;
  while (Date.now() < deadline) {
    if (stdoutBuf.includes(wantLine)) {
      await waitForHttp();
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`backend/index.js exited early (code ${child.exitCode}).\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`);
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for the server readiness line.\nstdout:\n${stdoutBuf}\nstderr:\n${stderrBuf}`);
}

async function waitForHttp(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${TEST_BASE_URL}/__qa_ping_unmatched`, { method: "GET" });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("Server process is up but not answering HTTP.");
}

export async function stopServer(): Promise<void> {
  const c = child;
  child = null;
  if (c && c.exitCode === null) {
    await new Promise<void>((resolve) => {
      c.once("exit", () => resolve());
      c.kill("SIGTERM");
      setTimeout(() => {
        if (c.exitCode === null) c.kill("SIGKILL");
        resolve();
      }, 4000);
    });
  }
  killPort();
  await sleep(200);
}

export async function restartServer(overrides: Record<string, string> = {}): Promise<void> {
  await stopServer();
  await startServer(overrides);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

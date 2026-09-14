import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * Load a CommonJS module from backend/ with specific dependencies replaced by
 * stubs. Works by seeding Node's require.cache with fake module records BEFORE
 * requiring the unit under test, so its top-level require() calls resolve to the
 * stubs. vi.mock() does not intercept CJS require() through createRequire, which
 * is why we do this by hand.
 *
 * @param backendDir absolute path to backend/
 * @param unitRelPath e.g. "./bl/userService.js"
 * @param stubs map of module specifier (as written in the unit's require()) -> stub object
 */
export function loadCjsWithStubs<T = any>(
  backendDir: string,
  unitRelPath: string,
  stubs: Record<string, any>
): T {
  const rb = createRequire(resolve(backendDir, "package.json"));
  const unitPath = rb.resolve(unitRelPath);
  const unitDir = resolve(unitPath, "..");
  const unitRequire = createRequire(unitPath);

  // Resolve each stub specifier from the unit's own location and seed the cache.
  const seededKeys: string[] = [];
  for (const [spec, stub] of Object.entries(stubs)) {
    let resolved: string;
    try {
      resolved = unitRequire.resolve(spec);
    } catch {
      // relative specifier: resolve against the unit's dir
      resolved = resolve(unitDir, spec);
    }
    (rb.cache as any)[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: stub,
    };
    seededKeys.push(resolved);
  }

  // Force a fresh copy of the unit so it re-runs its require() calls against the seeded cache.
  delete (rb.cache as any)[unitPath];
  const mod = rb(unitRelPath) as T;

  // Leave the seeded stub entries in place for the lifetime of the test file;
  // callers reset the stub objects' mock fns between tests.
  return mod;
}

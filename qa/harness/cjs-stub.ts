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

  // Resolve each stub specifier from the unit's own location and seed the cache,
  // remembering whatever was cached there before (often nothing, on a first
  // require) so it can be put back afterward.
  const seeded: { resolved: string; previous: any }[] = [];
  for (const [spec, stub] of Object.entries(stubs)) {
    let resolved: string;
    try {
      resolved = unitRequire.resolve(spec);
    } catch {
      // relative specifier: resolve against the unit's dir
      resolved = resolve(unitDir, spec);
    }
    seeded.push({ resolved, previous: (rb.cache as any)[resolved] });
    (rb.cache as any)[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: stub,
    };
  }

  // Force a fresh copy of the unit so it re-runs its require() calls against
  // the seeded cache -- remembering the previous entry (if any) for the same
  // "leave no trace" reason as the stubs above: a DIFFERENT test file may
  // plain-require this exact unit (e.g. tests/integration/categoryService.test.ts
  // requires bl/categoryService.js directly, unstubbed, against real Mongo)
  // and must get the real module, never this one wired to stub objects.
  const previousUnit = (rb.cache as any)[unitPath];
  delete (rb.cache as any)[unitPath];
  const mod = rb(unitRelPath) as T;

  // The unit-under-test's own top-level `require()` calls already captured a
  // direct reference to each `stub` object in its closure at the line above --
  // that reference survives independently of the require cache from here on
  // (callers mutate the same `stub` object between tests via vi.fn()/mockReset,
  // and the module keeps seeing it). So the seeded cache entries can, and must,
  // be put back to what they were right away: qa's vitest config runs every
  // test file in one shared process (singleFork, fileParallelism:false, so the
  // API tests share one server and one in-memory rate limiter), which means
  // Node's require cache is process-global, not per-file. Leaving a stub
  // entry seeded here would silently hand a LATER, unrelated test file's plain
  // `require("../dal/categoryRepository.js")` (or any other module sharing this
  // resolved path) this test's fake object instead of the real module --
  // exactly the kind of shared-mutable-state bug qa/'s own
  // test-data-management conventions rule out.
  for (const { resolved, previous } of seeded) {
    if (previous) (rb.cache as any)[resolved] = previous;
    else delete (rb.cache as any)[resolved];
  }
  if (previousUnit) (rb.cache as any)[unitPath] = previousUnit;
  else delete (rb.cache as any)[unitPath];

  return mod;
}

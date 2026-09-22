/**
 * Static (no-RTL-needed) cases from qa/specs/client-shared-components.md.
 * These are the two SC-* cases that are pure source-text checks and don't
 * need a jsdom/React-Testing-Library harness, which does not exist in qa/
 * today (see the final report for the gap this leaves for the rest of SC-*
 * and HT-*).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "../../harness/paths.js";

const CLIENT_SRC = resolve(REPO_ROOT, "client", "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]
  );
}
const allSourceFiles = walk(CLIENT_SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

describe("SC-01 -- one money formatter, used everywhere money is printed", () => {
  it("no currency-formatting expression outside lib/dashboardFormat.ts", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles) {
      if (file.endsWith(resolve(CLIENT_SRC, "lib", "dashboardFormat.ts"))) continue;
      const content = readFileSync(file, "utf8");
      // A currency-formatting EXPRESSION: shekel sign directly built from a
      // template/concat with a number expression, or .toFixed(2)/toLocaleString
      // called in a context that looks like money (heuristic: presence of the
      // pattern at all outside the one allowed file is the signal the spec
      // asks for).
      const looksLikeMoneyFormatting = /₪\s*\$?\{|\.toFixed\(2\)|toLocaleString\(/.test(content);
      if (looksLikeMoneyFormatting) offenders.push(file.replace(REPO_ROOT + "/", ""));
    }
    expect(offenders, `files with their own currency formatting: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every file that prints a ₪ amount imports money from lib/dashboardFormat", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles) {
      const content = readFileSync(file, "utf8");
      if (!content.includes("₪")) continue;
      const importsMoney = /from ['"].*lib\/dashboardFormat['"]/.test(content);
      // A file may legitimately show a literal ₪ in a comment (dashboardFormat.ts
      // itself, or a doc string) without importing itself.
      if (file.endsWith(resolve(CLIENT_SRC, "lib", "dashboardFormat.ts"))) continue;
      if (!importsMoney) offenders.push(file.replace(REPO_ROOT + "/", ""));
    }
    expect(offenders, `files printing ₪ without importing the shared formatter: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("SC-16 -- a regression in a shared component is visible in both places at once (import-graph guard)", () => {
  const importers = (componentFile: string) =>
    allSourceFiles
      .filter((f) => f !== resolve(CLIENT_SRC, "components", componentFile))
      .filter((f) => {
        const content = readFileSync(f, "utf8");
        const name = componentFile.replace(/\.tsx?$/, "");
        return new RegExp(`from ['"]\\.\\/?${name}['"]|from ['"].*\\/${name}['"]`).test(content);
      })
      .map((f) => f.replace(CLIENT_SRC + "/", ""));

  it("ChatScreen is imported by exactly HomePage.tsx and HowToUsePage.tsx", () => {
    const importedBy = importers("ChatScreen.tsx").filter((f) => !f.endsWith(".test.tsx"));
    expect(importedBy.sort()).toEqual(["components/HomePage.tsx", "components/HowToUsePage.tsx"].sort());
  });

  it("DashboardTotals is imported by exactly DashboardPage.tsx", () => {
    // client-shared-components.md §5 originally listed HowToUsePage.tsx as a
    // second caller too. Per the coordinator (2026-09-17, same session):
    // lesson 4's animation was deliberately removed and replaced with a link
    // to the real dashboard, so that import is gone BY DESIGN, not a defect.
    // Pinned to the current single-caller shape rather than the spec's
    // now-stale claim -- if a second caller reappears, this is the guard
    // that notices.
    const importedBy = importers("DashboardTotals.tsx").filter((f) => !f.endsWith(".test.tsx"));
    expect(importedBy.sort()).toEqual(["components/DashboardPage.tsx"]);
  });

  it("CategoryBreakdown is imported by exactly DashboardPage.tsx and HowToUsePage.tsx", () => {
    const importedBy = importers("CategoryBreakdown.tsx").filter((f) => !f.endsWith(".test.tsx"));
    expect(importedBy.sort()).toEqual(["components/DashboardPage.tsx", "components/HowToUsePage.tsx"].sort());
  });
});

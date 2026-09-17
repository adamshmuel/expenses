/**
 * Parses qa/specs/flow-fresh-2026-09-16.md and flow-lived-in-2026-09-16.md
 * directly, section by section, keyed by case ID (FR-*, XS-*, BD-*, LV-*).
 *
 * Why parse the spec instead of hand-transcribing each case into
 * testcases.mjs (the pattern the older US-, RA-, ... cases use): 85 cases
 * is a lot to retype by hand without introducing drift from the actual
 * spec, and the spec files are already exactly the "purpose / under test /
 * method / expected" shape the report needs -- just as a `### ID — title`
 * section instead of a JS object literal. Parsing it is the lazier AND the
 * more honest choice: the report always shows exactly what qa-lead wrote,
 * never a paraphrase that can drift from it.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(here, "..", "specs");

const HEADING_RE = /^### ([A-Z]{2}-\d{2}) — (.+)$/;

/** Very small markdown -> HTML converter, scoped to exactly what these spec
 *  files use: bold, inline code, bullet lists, blank-line paragraphs. Not a
 *  general-purpose renderer. */
function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");

  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (let raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    // A wrapped continuation line of the previous bullet (indented, not
    // blank, not a new bullet/heading) -- append to that <li> rather than
    // closing the list, so a multi-line bullet stays one list item.
    if (inList && /^\s+\S/.test(raw) && line.trim() !== "") {
      const last = out.pop();
      out.push(last.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (line.trim() === "") continue;
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      out.push(`<p>${inline(numbered[1])}</p>`);
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function parseFile(filename) {
  const text = readFileSync(resolve(SPECS_DIR, filename), "utf8");
  const lines = text.split(/\r?\n/);
  const cases = {};
  let currentId = null;
  let currentTitle = null;
  let buf = [];

  const flush = () => {
    if (currentId) {
      cases[currentId] = { title: currentTitle, html: mdToHtml(buf.join("\n")), file: filename };
    }
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    // A new case heading, OR any other heading (###/##/---) ends the current case body.
    if (m) {
      flush();
      currentId = m[1];
      currentTitle = m[2];
      continue;
    }
    if (/^#{1,3}\s/.test(line) || /^---\s*$/.test(line)) {
      flush();
      currentId = null;
      currentTitle = null;
      continue;
    }
    if (currentId) buf.push(line);
  }
  flush();
  return cases;
}

export const FLOW_CASES = {
  ...parseFile("flow-fresh-2026-09-16.md"),
  ...parseFile("flow-lived-in-2026-09-16.md"),
};

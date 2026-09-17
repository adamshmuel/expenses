/**
 * The three PROPOSED bars from qa/specs/flow-fresh-2026-09-16.md Group 9/10
 * and FR-43 — qa-lead's proposal, not yet confirmed by Adam. Every case that
 * asserts against one of these numbers imports it from here, so a single
 * edit updates every test at once once Adam rules on the real number.
 *
 * Tests using these MUST label their report entry "provisional bar" (see
 * qa/scripts/build-report.mjs) — never presented as an agreed spec value.
 */

/** Group 9 — how fast it feels (flow-fresh-2026-09-16.md). All in ms. */
export const RESPONSE_BUDGET_MS = {
  screenUsableAfterNav: 2_000,
  dashboardRendersFresh: 2_000,
  confirmCompletes: 2_000,
  chatReplyRealModel: 10_000,
  visibleFeedback: 300,
  chatReplyAtVolume: 10_000, // LV-24 — same bar, larger context sent to the model
  dashboardRendersAtVolume: 2_000, // LV-24
  chatHistoryLoadAtVolume: 2_000, // LV-24 — 240 messages
} as const;

/** Group 10 — "does it look right" (flow-fresh-2026-09-16.md). */
export const LOOKS_RIGHT = {
  widths: [375, 768, 1280] as const,
  minTouchTargetPx: 44,
};

/**
 * FR-43 — the app answers in the language it was written to. PROPOSED and,
 * per the task brief, to be DELETED (not weakened) if Adam rejects it rather
 * than silently skipped. Flip to false only on that explicit instruction —
 * do not use this flag to quietly soften the assertion.
 */
export const LANGUAGE_MATCH_BAR_ACTIVE = true;

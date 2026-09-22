# Product first, course topics second

The app must work as a real product before it works as a course exercise.

- Design the feature the way a real user needs it. Only then ask which course
  topic it happens to demonstrate.
- **Never invent a feature in order to tick a course topic.** If a topic has no
  honest place in the product, it does not go in, and we find a different way to
  cover it — or accept that it is not covered.
- A feature that looks useful but misleads the user is worse than a missing
  feature.
- When a course topic and good UX pull in different directions, UX wins. Say so
  out loud, and note which topic went uncovered.

## A bug is fixed when the user's flow works, not when the error changes

Judge every bug from the user's seat, not the stack trace's. The user has a
goal — *add an expense* — and does not care which layer failed, who owns the
file, or that the fix surfaced a new problem underneath.

- **Never call a bug fixed while the flow it blocks is still blocked.** A 500
  that becomes a 400, a crash that becomes a red banner, a banner that becomes
  a dead end — that is the same bug, moved. Keep going until the user can
  finish what they set out to do.
- **Re-test the whole flow end to end after each fix**, not just the line that
  changed. Fixing the reported symptom and stopping there is how a bug gets
  declared closed three times while still being broken.
- **A blocked core flow is a major bug**, whatever its cause. Adding an
  expense is this app's entire purpose; if it cannot be completed, nothing
  about severity is up for debate.
- When a fix reveals a deeper cause, that is not a new ticket to file and move
  on from — it is the same bug, still open. Say so plainly and keep fixing.
  Logging it and continuing to test something else leaves the user broken.

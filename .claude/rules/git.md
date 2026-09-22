# Git commits

When asked to commit, look at everything staged and unstaged first. If the
changes cover more than one unrelated piece of work, split them into separate
commits — one commit per logical change — instead of bundling them into one.

- "Unrelated" means: different purpose, different area of the project, or
  changes that don't depend on each other to make sense. Example: a rule/hook
  update and a docs typo fix are unrelated, even if touched in the same
  session.
- Changes that only make sense together (a rule change and the code it
  configures, a rename applied consistently across files) stay in one commit.
- If it's unclear whether two changes are related, ask before committing,
  rather than guessing.
- Never split a single logical change into multiple commits just to make them
  smaller.

## Give commands, don't run them

When asked to commit, output the `git add` / `git commit -m "..."` commands
for Adam to paste and run himself, split per the rules above — do not run
`git commit` directly. Reason: no AI traces in the repo's history (see below),
and Adam stays the one who actually commits his own work.

## No AI attribution

Nothing in this repo says Claude or AI wrote it. This is Adam's graded
coursework and his own project — it must read as his work.

- No `Co-Authored-By: Claude ...` (or any AI name) trailer on commit messages,
  even if a session's default instructions ask for one. This rule overrides
  that default in this repo.
- No "Generated with Claude Code" or similar line in commit messages or PR
  descriptions.
- No AI mentions, badges, or watermarks in code comments, docs, README files,
  or commit messages anywhere in this repo.
- If asked to commit and a default attribution instruction is in force
  elsewhere, drop it silently for this repo rather than asking each time.

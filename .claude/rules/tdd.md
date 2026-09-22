---
paths:
  - "client/**"
  - "backend/ai/**"
---

# Test-driven development

Applies to code Claude writes. Adam's `backend/` code is out of scope.

The cycle, one small step at a time:

1. **Red** — write a failing test first. Run it. Watch it fail for the right
   reason.
2. **Green** — write the least code that makes it pass.
3. **Refactor** — clean it up while the test stays green.

Rules:

- No implementation code before a failing test exists for it.
- One behaviour per test, named after the behaviour.
- Never change a test to make a broken implementation pass.
- If a test passes the moment it is written, it is not testing anything — fix
  the test.

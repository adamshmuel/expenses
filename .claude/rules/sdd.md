# Spec-driven development

Specs live in `docs/specs/`. Implementation plans live in `docs/plans/`.

The order is always: **spec → Adam approves → plan → code.**

- No feature is coded before its spec exists in `docs/specs/` and Adam has
  approved it.
- A spec describes *what* and *why*: screens, behaviour, data, edge cases. Not
  code.
- A plan describes *how*: the steps to build it, in TDD order. One plan file per
  spec, written only after that spec is approved.
- When the code and the spec disagree, the spec is updated first, then the code.
- Specs contain no "TBD". An open question is either answered or listed
  explicitly under an "Open questions" heading.

## Coding starts only when Adam says so

Approving a spec, or approving a plan, is **not** permission to write code.

Claude keeps planning — specs, designs, build plans — until Adam says
explicitly: *"let's start coding X."* Then only X is coded, nothing else.

If a plan seems to lead naturally into code, it stops at the plan anyway and
waits.

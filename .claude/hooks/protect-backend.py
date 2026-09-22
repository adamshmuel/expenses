#!/usr/bin/env python3
"""Refuse any write under backend/, except backend/ai/.

backend/ is Adam's own work for a graded course project. backend/ai/ is
Claude's. The rule is written down in .claude/rules/ownership.md; this hook is
what makes it a hard stop rather than a request.

One narrow exception: an edit that only adds or changes comments, JSDoc
blocks, or docstrings — with the underlying code byte-identical before and
after — is allowed through structurally. .claude/rules/ownership.md says
Claude must still only use this when Adam explicitly asks for it in that
turn; this hook cannot check intent, only the diff.

Reads the PreToolUse payload on stdin. Silence means "allowed".
"""

import json
import os
import re
import sys

REASON = (
    "Blocked by .claude/hooks/protect-backend.py.\n\n"
    "{rel} is under backend/, which is Adam's own graded coursework. "
    "Claude writes client/ and backend/ai/ only — see .claude/rules/ownership.md.\n\n"
    "This edit changes code, not just comments/docs, so the doc-only exception "
    "does not apply. Do not retry, and do not write this file anywhere else for "
    "him to copy. Describe what the server needs to do instead, and let Adam "
    "write it."
)

# Matches, in order of alternation:
#   1) a block comment /* ... */ (JSDoc included, since it's just /** ... */)
#   2) a line comment // ... to end of line
#   3) a Python triple-quoted string (used as a docstring), '''...''' or """..."""
#   4) a Python line comment # ... to end of line
_COMMENT_OR_DOCSTRING = re.compile(
    r"/\*.*?\*/"
    r"|//[^\n]*"
    r"|'''.*?'''"
    r'|""".*?"""'
    r"|#[^\n]*",
    re.DOTALL,
)


def strip_comments(text: str) -> str:
    """Remove comments/docstrings, then collapse whitespace, so two versions
    of a file that differ only in comments/docstrings compare equal."""
    without_comments = _COMMENT_OR_DOCSTRING.sub("", text)
    return "".join(without_comments.split())


def is_all_comment_lines(text: str) -> bool:
    """True when every non-blank line is a comment line.

    `strip_comments` can only recognise a block comment it sees *whole*, with
    both `/*` and `*/` present. An Edit that rewrites the middle of a JSDoc
    block sends neither delimiter — just ` * @param ...` lines — so the
    stripper leaves them intact and two different doc texts look like changed
    code. This catches that case structurally instead: a fragment whose every
    line is a comment continuation cannot contain code, whatever it says.

    Deliberately strict — one non-comment line anywhere makes the whole
    fragment ineligible, so a real code change can never ride along inside a
    docblock edit.
    """
    lines = [line.strip() for line in text.splitlines()]
    meaningful = [line for line in lines if line]
    if not meaningful:
        return False  # Nothing to vouch for: let the normal comparison decide.
    return all(
        line.startswith("*") or line.startswith("//") or line.startswith("#")
        for line in meaningful
    )


def is_doc_only_edit(tool_name: str, tool_input: dict, real_path: str) -> bool:
    if tool_name == "Edit":
        old_string = tool_input.get("old_string")
        new_string = tool_input.get("new_string")
        if old_string is None or new_string is None:
            return False
        if strip_comments(old_string) == strip_comments(new_string):
            return True
        # Both sides entirely comment lines: an edit within a docblock.
        return is_all_comment_lines(old_string) and is_all_comment_lines(new_string)

    if tool_name == "Write":
        new_content = tool_input.get("content")
        if new_content is None:
            return False
        try:
            with open(real_path, "r", encoding="utf-8") as f:
                current_content = f.read()
        except OSError:
            return False  # New file: nothing to prove is "unchanged code".
        return strip_comments(current_content) == strip_comments(new_content)

    # MultiEdit, NotebookEdit, or anything else: too hard to prove safe here.
    return False


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return  # A payload we cannot read is not a reason to block work.

    tool_name = payload.get("tool_name") or ""
    tool_input = payload.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not path:
        return

    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    real_path = os.path.realpath(path)
    try:
        relative = os.path.relpath(real_path, os.path.realpath(root))
    except ValueError:
        return  # A different drive on Windows: not our backend/ directory.

    parts = relative.split(os.sep)
    inside_backend = parts[:1] == ["backend"]
    inside_ai = parts[1:2] == ["ai"]

    if not inside_backend or inside_ai:
        return

    if is_doc_only_edit(tool_name, tool_input, real_path):
        return  # Comments/docstrings only, code unchanged: let it through.

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": REASON.format(rel=relative),
                }
            }
        )
    )


if __name__ == "__main__":
    main()

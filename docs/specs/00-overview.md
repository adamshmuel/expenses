# 00 — Overview

Status: **draft — needs Adam's approval.**

## What we are building

A home budget app. The user writes an expense in plain language, an AI turns it
into structured data, the user confirms it, and it is saved. A second screen
shows statistics about what was saved.

## Screens

| Route | What it does | Spec |
|---|---|---|
| `/home` | AI chat. The user types their expense or expenses. | [01-ai-chat.md](01-ai-chat.md) |
| `/dashboard` | Statistics about the saved expenses. | [02-dashboard.md](02-dashboard.md) |

## Purpose

This is Adam's Node.js course final project. Its goal is to demonstrate as much
of the course curriculum as possible in one working app. Feature choices serve
that goal.

## Constraints

- **6 working days.** Finished and simple beats ambitious and half-done.
- Server and client both run on Adam's computer. Deployment to his Hostinger
  server is considered only after the app works locally.
- Adam writes the server himself, at a beginner's pace. See
  `.claude/rules/ownership.md`.

## Shape

Three parts:

- `server/` — the API and the database. Adam's work.
- `server/ai/` — turns free text into a structured expense. Claude's work.
- `client/` — the two screens. Claude's work.

The client never talks to the language model directly. It calls the server, and
the server calls `server/ai/`.

## Open questions

1. Which course technologies go into this project. The full subject list is in
   [../reference/course-topics.md](../reference/course-topics.md) — next step is
   to choose from it.
2. Which language model provider. Gemini Flash Lite was mentioned as the
   cheapest option; not yet decided.
3. Whether the app has user accounts, and what the dashboard shows. Answered in
   `02-dashboard.md` and `03-api-contract.md` once question 1 is settled.

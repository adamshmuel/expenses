# 00 — Overview

Status: **draft — needs Adam's approval.**

## What we are building

A home budget app. **The chat is the only way to change anything.** The user
writes in plain language — recording an expense, editing or deleting one,
adding or renaming a category, moving an expense to a different category — an
AI turns it into a structured action, the user confirms it, and it is saved. A
second screen shows the result: statistics and lists, to look at, never to
edit directly.

## Screens

| Route | What it does | Spec |
|---|---|---|
| `/home` | AI chat. The only place the user creates, edits, or deletes anything — expenses and categories alike. | [01-ai-chat.md](01-ai-chat.md) |
| `/dashboard` | Read-only statistics and lists, built from what was saved through the chat. | [02-dashboard.md](02-dashboard.md) |

The API between the two sides is [03-api-contract.md](03-api-contract.md); the
database behind it is [04-data-model.md](04-data-model.md). The server layers
behind it: auth in [05-user-layers.md](05-user-layers.md), and expenses and
categories split across the DAL ([08-expense-category-dal.md](08-expense-category-dal.md))
and the service/route layers on top of it
([09-expense-category-service.md](09-expense-category-service.md)).

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

- `backend/` — the API and the database. Adam's work.
- `backend/ai/` — turns free text into a structured expense. Claude's work.
- `client/` — the two screens. Claude's work.

The client never talks to the language model directly. It calls the server, and
the server calls `backend/ai/`.

## Open questions

1. Which course technologies go into this project. The full subject list is in
   [../reference/course-topics.md](../reference/course-topics.md) — next step is
   to choose from it.
2. Which language model provider. Gemini Flash Lite was mentioned as the
   cheapest option; not yet decided.
3. Whether the app has user accounts, and what the dashboard shows. Answered in
   `02-dashboard.md` and `03-api-contract.md` once question 1 is settled.

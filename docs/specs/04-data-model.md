# 04 — Database and models

Status: **agreed. Adam writes the Mongoose schemas from this.**

Five collections. This says what each one holds and why. The schema code is
Adam's to write — see `.claude/rules/ownership.md`.

Single currency for v1: every amount is a number of **shekels**. No currency
field, no conversion. Multi-currency would be a v2 change.

## `User`

| Field | Type | Rules |
|---|---|---|
| username | String | required, unique, 3–20 characters |
| email | String | required, unique, valid email |
| password | String | required, bcrypt hash, never returned to the client |
| createdAt | Date | set automatically |

## `Category`

One collection, two levels deep, one private set per user.

| Field | Type | Rules |
|---|---|---|
| name | String | required, trimmed |
| parent | ObjectId → Category | empty means this **is** a main category |
| owner | ObjectId → User | required, indexed |
| isProtected | Boolean | true only for "Other" — blocks renaming and deleting |

**Two levels, never three.** Before saving, check that the chosen `parent` has
no parent of its own. A subcategory can never itself be a parent.

**No duplicates.** A compound unique index on `owner + parent + name` stops one
user creating "Fuel" twice under "Transport". Two different users can still each
have their own "Fuel".

**Every user owns their categories.** There is no shared global category
document. At sign-up the default set below is **copied** into that user's own
documents, so editing or deleting one only ever affects that user.

**Reset to defaults** deletes the user's categories and copies the defaults in
again. Expenses are re-pointed at the fresh "Other" first, so nothing is lost.

### The default set

Copied to every new user at sign-up, and again on reset. Keep the list in one
place in the server code so sign-up and reset can never drift apart.

| Main | Subcategories |
|---|---|
| Food | Groceries, Restaurants, Coffee |
| Transport | Fuel, Public transport, Parking |
| Home | Rent, Utilities, Internet |
| Health | — |
| Clothing | — |
| Entertainment | — |
| Education | — |
| **Other** | — *(protected)* |

## `Expense`

| Field | Type | Rules |
|---|---|---|
| amount | Number | required, greater than 0, in shekels |
| store | String | optional — the AI does not always find one |
| description | String | optional |
| date | Date | required, defaults to today |
| category | ObjectId → Category | required |
| user | ObjectId → User | required |
| createdAt | Date | set automatically |

Index on `user + date`. Every dashboard query is "this user, this period", so
that index is the one that matters.

**When a category is deleted, its expenses move to that user's "Other".** They
are never deleted with it — spending history is not something the user meant to
throw away.

Do this in **one Mongoose middleware on the Category model**, not by hand in
each route, so it cannot be forgotten. Deleting a *main* category also moves its
subcategories' expenses, then deletes those subcategories.

## `Message`

The chat history on `/home`. Written once, never edited or deleted — see
`01-ai-chat.md`.

| Field | Type | Rules |
|---|---|---|
| text | String | required |
| role | String | required, either `user` or `assistant` |
| author | ObjectId → User | required, indexed |
| createdAt | Date | set automatically |

## `RefreshToken`

So that logging out really does invalidate a token, and so restarting the server
does not log everyone out.

| Field | Type | Rules |
|---|---|---|
| token | String | required, unique |
| user | ObjectId → User | required, indexed |
| expiresAt | Date | required |

Put a **TTL index** on `expiresAt`. MongoDB then deletes expired tokens on its
own and the collection never grows forever.

- **Login** creates one.
- **Refresh** deletes the old one and creates a new one — that is the rotation.
- **Logout** deletes it.

## How they connect

```
User ─┬─< Category ──< parent → Category
      ├─< Expense >── Category
      ├─< Message
      └─< RefreshToken
```

Everything except `Category.parent` points back to a user. Nothing is shared
between users, so every query is filtered by the logged-in user first.

## What this earns

| Course topic | Demo | Where |
|---|---|---|
| Mongoose schemas and models | 18 | All five collections |
| Population | 23 | Expense → Category, Category → parent, Message → author |
| bcrypt | 19 | The `password` field |
| Advanced security | 24 | `RefreshToken` rotation |
| Input validation | 22 | Unique checks, the two-level parent rule |

## Open questions

1. Should an `Expense` record which `Message` created it? It would let the chat
   show "saved" next to an old message. Not needed for v1.
2. Does an expense need an `updatedAt`, or is editing an expense out of scope
   for v1? Editing is not in any approved spec yet.

# Course subjects — reference

Not a spec. A complete list of what the course teaches and what Adam has
actually written, so we can choose the technologies for this project against
real evidence instead of memory.

Scanned on 2026-09-08.

## Sources

| # | Path | What it is |
|---|---|---|
| 1 | `~/Dev/Fullstack_Course_RT` | Instructor's code, whole course (local copy) |
| 2 | `~/Dev/Fullstack_Course_RT/07 - NODE` | Node.js section: 27 demos + 13 exercises |
| 3 | `~/Dev/fs_server` | Adam's own Node.js exercises |
| 4 | `~/Dev/fs_first_project` | Adam's React final project |

Course sections: `01 - HTML`, `02 - CSS`, `03 - JS`, `04 - DOM`,
`05 - REST API - WebService`, `06 - REACT`, `07 - NODE`, plus `Labs/`
(practice PDFs) and `Labs/Projects/` (the final project briefs).

---

## The instructor's Node.js final project briefs

Four options in `~/Dev/Fullstack_Course_RT/Labs/Projects/07 - NODE`. Adam is
building his own idea instead, but these define what "a finished Node project"
means to the instructor, so they are the bar to clear.

| Brief | App | Distinctive demand |
|---|---|---|
| Easy — Live Board | Trello-style board | Real-time updates via Socket.io, owner/member roles |
| Medium — TeamSync | Slack-style workspaces | Nested rooms, per-workspace roles, notifications |
| Hard — ProjectFlow | Asana/Jira platform | Two-layer permissions, 4-level hierarchy, audit log, pagination everywhere |
| Special — ReadLater | Bookmarks over an external API | DAL/BL over two data sources: Axios + local JSON files. No MongoDB |

**Every brief demands the same core list**, which is the real requirement:

- Async and error handling
- MongoDB + Mongoose (except the Special brief)
- Auth with bcrypt + JWT
- Middleware and logging
- Winston
- Input validation
- Routers / Controllers / MVC
- Population
- Advanced security + refresh tokens
- Real-time communication (Socket.io) — in three of the four briefs
- Rate limiting, helmet, CORS locked to a specific origin
- A separate error log file
- Pagination, sorting, filtering on list endpoints (Hard brief)

---

## Node.js subjects — the 27 course demos

`✅` = Adam has written it himself in `~/Dev/fs_server`.

| # | Demo | Subject | Adam |
|---|---|---|---|
| 1 | `demo1_run` | Running node, first script | ✅ |
| 2 | `demo2_modules` | `require` / `module.exports` | ✅ |
| 3 | `demo3_process` | `process`, `process.argv` | ✅ |
| 4 | `demo4_fs` | File system: sync, callback, promise | ✅ |
| 5 | `demo5_path` | `path` module | ❌ |
| 6 | `demo6_node` | Node basics, event loop | ✅ |
| 7 | `demo7_http` | Raw `http.createServer`, manual routing | ✅ |
| 8 | `demo8_microService` | DAL/BL layers, Axios to an external API | ✅ |
| 9 | `demo9_express` | Express basics | ✅ |
| 10 | `demo10_express_route` | Routes | ✅ |
| 11 | `demo11_express_params` | Route params (`/:id`) | ✅ |
| 12 | `demo12_express_queryString` | Query strings | ✅ |
| 13 | `demo13_express_crud` | Full CRUD | ✅ |
| 14 | `demo14_express_middleWare` | Middleware | ✅ |
| 15 | `demo15_express_router` | `express.Router()` per resource | ✅ |
| 16 | `demo16_express_error` | Error handling, `catchAsync` | ✅ |
| 17 | `demo17_express_cors_static_env` | CORS, static files, `dotenv` | ✅ |
| 18 | `demo18_mongoose` | MongoDB + Mongoose, schemas, models | ✅ |
| 19 | `demo19_bcrypt_JWT` | Password hashing, JWT login | ✅ |
| 20 | `demo20_advanceMiddleWare` | Middleware factories, roles | ✅ |
| 21 | `demo21_Winston` | Winston logging, morgan → winston, log files | ✅ |
| 22 | `demo22_express_validator` | Input validation, custom + async validators | ✅ |
| 23 | `demo23_population` | Refs between documents, `populate`, virtuals | ✅ |
| 24 | `demo24_security` | helmet, rate limit, CSRF, refresh tokens, cookies | ✅ |
| 25 | `demo25_FileSystem_Stream` | Streams, large files | ❌ |
| 26 | `demo26_socket` | Socket.io, real-time rooms | ❌ (installed, never used) |
| 27 | `demo27_cors` | CORS in depth | ✅ |

### Gaps

Three subjects Adam has never written: **`path`**, **streams**, and
**Socket.io**. Socket.io is the significant one — it appears in three of the
four instructor briefs.

### Libraries used in the course Node demos

Ordered by how many demos use them.

`express` (29) · `nodemon` (25) · `cors` (18) · `dotenv` (15) · `mongoose` (9) ·
`jsonwebtoken` (6) · `morgan` (4) · `jsonfile` (3) · `bcrypt` (3) ·
`winston` (2) · `express-validator` (2) · `compression` (2) · `axios` (2) ·
`winston-daily-rotate-file` · `socket.io` · `helmet` · `express-rate-limit` ·
`csurf` · `cookie-parser`

Adam's `fs_server` uses the same set, minus nothing — every library above
appears in his own exercises too. `socket.io` is in his `package.json` but no
socket code exists.

**Never taught, never used:** any test framework, multer, joi, TypeScript on the
server.

---

## Adam's own Node.js exercises

`~/Dev/fs_server`, six folders, each building on the last.

| Folder | What he practised |
|---|---|
| `ex_1` | `fs` three ways, `process.argv`, own `utils.js`, writing JSON |
| `ex_2_server` | Raw `http`, manual `switch (request.url)` routing |
| `ex3_microService` | First layer split: `index → bl/ → dal/`, Axios, `jsonfile` |
| `ex4_express` | `express.Router()` per resource, global API-key middleware |
| `ex5_more_express` | `express.json`, static files, CORS, `dotenv`, `catchAsync` |
| `ex6_mongodb` | Mongoose, auth, winston, validation, security middleware |

**His architecture, from `ex6_mongodb`** — this is the pattern the new server
should follow:

```
route → bl (service) → dal (repository) → model
```

with `.config/db.js`, `.config/logger.js`, `middlewares/`, `validators/`, and a
single `error_handling.js` holding `catchAsync` plus one 4-argument
`errorHandler` registered last.

Auth in his code: access token + refresh token with **separate secrets**, token
rotation, an in-memory whitelist, CSRF-protected refresh endpoint, and a
`requireRole('admin')` middleware factory.

---

## Front-end subjects

### `03 - JS`
Variables & operators · conditions · loops · arrays & objects · functions ·
sessionStorage · classes · advanced functions · async programming · try-catch ·
`this`

### `04 - DOM`
Selecting elements · events · `innerText` · input values · styling from JS ·
checkbox / radio / select · `createElement` · bubbling · capturing

### `05 - REST API`
Consuming a REST API from the browser: GET all, GET by id, POST, PUT, PATCH,
DELETE

### `06 - REACT`
Components & props · events · state · refs · conditional rendering (styling,
repeaters, create/destroy) · lifting state up · Axios · forms · lifecycle ·
React Router DOM · React Redux — plus a separate TypeScript section

### Adam's React final project
`~/Dev/fs_first_project/tv-show-app` — React 19 + TypeScript + Vite,
Redux Toolkit with async thunks, React Router (list + nested detail route),
Axios, loading/error states. This is the stack he can defend, and the natural
choice for this project's client.

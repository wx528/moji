# MoJi 墨迹写作 — AI Writing App

> Ink your thoughts — every trace becomes a galaxy.

A **full-stack writing app** built on Next.js 15 (App Router) + SQLite. The UI was faithfully restored from a Figma design. It ships with a complete account system, multi-book management, chapter editing and writing stats — plus **AI Continuation**, **Lore Consistency Check**, and **plan-driven AI Orchestration** for long-form generation, all wired to any OpenAI-compatible API.

![Tech](https://img.shields.io/badge/Next.js-15-black) ![React](https://img.shields.io/badge/React-19-blue) ![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-green) ![License](https://img.shields.io/badge/License-MIT-blue)

English · [Changelog](./CHANGELOG.md) (中文) · [Roadmap](#roadmap) · [简体中文](./README.md)

## Screenshots

**Login**
![Login](public/screenshots/login.png)

**Bookshelf (multi-book + writing stats)**
![Bookshelf](public/screenshots/shelf.png)

**Editor · Light**
![Editor light](public/screenshots/editor.png)

**Editor · Dark**
![Editor dark](public/screenshots/editor-dark.png)

## Features

### Accounts
- Register / login with front- and back-end validation (email format, password strength)
- Passwords stored as `scrypt` hashes; sessions use HMAC-signed httpOnly cookies
- "Remember me": session valid for 30 / 7 days
- `middleware` route guards: visiting `/editor` or `/shelf` while logged out redirects to the login page

### Bookshelf (`/shelf`)
- Multi-book management: create, switch books; data isolated per user
- **Delete book**: hover a card to reveal the delete button; soft-delete on confirm (chapter content stays in the database), deleted books are inaccessible via URL
- **Realistic book covers**: Chinese-style binding design (spine, double-rule frame, first-character seal, vertical title) in 6 ink-toned palettes, stably assigned by book ID
- **Writing stats**: today / total words, days written in the last 14 days + a pure-CSS bar chart (zero chart dependencies, dark-mode aware)

### Editor (`/editor`)
- Manuscript is directly editable (`contentEditable`), no caret jumping
- **Autosave**: persisted 0.8s after you stop typing; the top bar shows "Saving… → Saved"
- **Chapter management**: create (➕), double-click to rename, drag to reorder (chapters and sections sort independently, gold indicator line), move to trash
- **Collapse/expand sections**: state persisted to localStorage
- **Trash**: soft-delete → restore / purge
- **Note cards / Story outline**: dual tabs in the right panel, per-book data; cards are directly editable (`contentEditable`, autosave on blur), double-click titles to rename, add new cards; first visit to an old book auto-generates default cards (main characters / plot memo / main outline / chapter points)
- **AI Continuation**: the "Continue" button on the bottom toolbar streams text at the caret via SSE in 100 / 300 / 500 word increments, stoppable anytime; insertions flow through the existing autosave pipeline. The book's **note cards and story outline (Lore Book)** are injected automatically so characters, world rules, and established plot stay consistent. Works with any OpenAI-compatible service (Zhipu GLM / DeepSeek / Kimi / MiniMax / OpenAI) — see [Environment variables](#environment-variables-optional)
- **Lore Consistency Check**: the "Check Lore" button audits the current chapter against your note cards and story outline; the dialog lists every conflict — severity (contradiction / questionable), the offending sentence, the conflicting card, the reason, and a fix suggestion; clean chapters get a pass verdict
- **AI Orchestration (plan-driven long-form generation)**: the "Orchestrate" button takes a natural-language master plan (e.g. "5 arcs × 10 chapters, themes…"). A master orchestrator breaks the book into a structured per-arc plan, persisted to the "AI Plan" outline card. Each run generates one unfinished arc — at arc start, 2~3 random existing chapters are sampled into a **per-arc inspiration pool** (shared within the arc); each chapter gets a beat outline (title + plot points + an unexpected twist direction) and is streamed into prose; a lore self-check auto-rewrites once on contradictions. Full-stage progress and live text preview are visible in the dialog, stoppable anytime with **resume-exactly-where-you-stopped (per chapter)**; one arc per run, with a prompt to continue to the next. Arcs = top-level chapters, chapters = sections (e.g. `1.3 Ashen Whispers`)
- **Live word counts**: current chapter / whole book / words today, updated in real time
- **Markdown export**: one-click download of a chapter or the whole book

### More
- 🌙 Dark mode: CSS-variable theming, persisted preference, no first-paint flash
- 📱 Responsive: right panel hidden < 1024px, left tree hidden < 768px

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Backend | Next.js API routes (full-stack, no separate server) |
| Database | SQLite (better-sqlite3), WAL mode |
| Auth | scrypt password hashing + HMAC-signed cookies + middleware guards |
| Styling | Plain CSS (design-token driven, no UI framework) |
| UI origin | Restored from a Figma design via Tencent CodeBuddy's Figma import |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Seed demo data: account demo@moji.app / moji123456
npm run seed

# 3. Start the dev server
npm run dev

# 4. Open http://localhost:3000 and log in with the demo account
```

> Skipping the seed also works: register at `/register` and your first login auto-creates a sample book, *A Guide to Wandering the Star River* (5 chapters, 3 sections of seed content).

### Seed script

```bash
npm run seed              # idempotent: skips existing users/books
npm run seed -- --reset   # DANGEROUS: wipes .data and re-initializes
```

Override via environment variables: `SEED_EMAIL`, `SEED_PASSWORD`, `SEED_NAME`.

### Environment Variables (optional)

| Variable | Description | Default |
|---|---|---|
| `MOJI_SECRET` | Session signing secret | Dev default — **must be set in production** |
| `MOJI_AI_KEY` | AI service key | The "Continue" button prompts for setup if unset |
| `MOJI_AI_MODEL` | Model name (e.g. `glm-4-flash`, `deepseek-chat`) | ditto |
| `MOJI_AI_BASE` | OpenAI-compatible API base URL | `https://open.bigmodel.cn/api/paas/v4` (Zhipu) |

Put the AI config in `.env.local` at the project root (git-ignored), then restart `npm run dev`:

```bash
# Zhipu GLM (has free models)
MOJI_AI_BASE=https://open.bigmodel.cn/api/paas/v4
MOJI_AI_KEY=your-key
MOJI_AI_MODEL=glm-4-flash

# or DeepSeek
# MOJI_AI_BASE=https://api.deepseek.com
# MOJI_AI_MODEL=deepseek-chat
```

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
├── app/
│   ├── page.jsx               # Login page (/)
│   ├── register/              # Register page
│   ├── shelf/                 # Bookshelf (multi-book + stats)
│   ├── editor/                # Editor (the core)
│   ├── api/
│   │   ├── auth/              # login / register / logout / me
│   │   ├── book/              # book + chapter tree (supports ?bookId=)
│   │   ├── books/             # book list / create / delete ([id])
│   │   ├── chapters/          # chapter CRUD / sort / restore
│   │   ├── cards/             # note cards create / edit (per-book)
│   │   ├── ai/                # AI continuation (SSE proxy) / lore check / orchestration
│   │   ├── trash/             # trash listing
│   │   └── stats/             # writing stats
│   └── globals.css            # design tokens (light/dark themes)
├── lib/
│   ├── auth.js                # user store, password hashing, session signing
│   ├── db.js                  # SQLite connection & migrations
│   ├── books.js               # book/chapter business logic
│   ├── lore.js                # Lore Book injection (cards → AI context)
│   └── stats.js                # daily word counts
├── middleware.js              # auth guards
├── public/assets/             # icons exported from Figma
└── .data/                     # runtime data (git-ignored)
```

## Data Model

```
books(id, user_email, title, created_at, deleted)          -- deleted: soft delete from shelf
chapters(id, book_id, parent_id, title, content, sort_order, deleted, deleted_at, updated_at)
writing_stats(user_email, date, words)                     -- net daily word delta
note_cards(id, book_id, tab, title, body, sort_order, updated_at)  -- note cards (tab: notes/outline)
```

- Chapters and books are soft-deleted (trash / data retention); sections attach via `parent_id`
- Writing stats record word deltas on each save; deletions subtract faithfully
- Legacy databases are upgraded by idempotent column migrations at startup in `lib/db.js` (`ALTER TABLE ... ADD COLUMN`)

## Roadmap

- [ ] Deploy (Vercel + Turso, or any persistent-disk platform)
- [ ] Bookshelf search
- [ ] Group trash by book
- [ ] Finer daily word curve (hourly)
- [ ] Rich-text toolbar (bold/italic etc.; the floating bottom toolbar currently hosts the AI features)

## License

[MIT](./LICENSE)

## Acknowledgements

- UI design originated in Figma, restored via CodeBuddy's Figma import
- To every writer who codes words late into the night — this project is for you

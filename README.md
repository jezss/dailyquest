# Daily Quest — personal daily goals

A single-user daily tracker built around your GitHub issues. Each day you work on issues (with a note per issue per day) plus anything else you want to get done, tick things off, see what you got done (including real GitHub activity), and look back over your week or follow one issue across days. Runs entirely in your browser: no backend, no account. Data is saved in `localStorage`, and optionally also to a folder you choose as Parquet files (see *Data folder* below).

## Run

Requires Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/
npm test           # vitest
npm run typecheck
```

## What's in it

- **Today:** an intention for the day, then **Issues** first — your GitHub issues for the day, each with its own note for that day — followed by **Not on GitHub** for anything without an issue. Items have a status (To do / In progress / Done / Skipped), can be reordered, and one can be your ★ focus. Open issues assigned to you are listed as "Work on today" suggestions; nothing is added until you choose it. An item without an issue can be **linked to an issue** later, which turns it into a note on that issue. Also an end-of-day reflection (win, notes, for tomorrow), a progress ring, and a **Highlights** list of what you finished.
- **Carry-over:** unfinished goals from your last day are offered once; you choose which to bring forward.
- **History:** a 7-day strip, streak (consecutive days with something done or highlighted — a quiet morning never breaks it), and every past day (open and edit any), viewed **By day** or **By issue**. By issue lists each GitHub issue you've worked on with every day it appeared, that day's status and note, and *Copy issue log*. *Copy this week* groups the week by issue.
- **Achievements:** computed from your saved days only (First Step, Clean Sweep, Steady Three, Full Week, Focus Finisher, Shipper, Issue Closer, Reflective). Nothing unlocks unless the records show it.
- **Copy / download** a Markdown summary of any day: issues first (with each day's note), then other work, GitHub activity and your reflection.
- **Settings:** your name, a gentle goal limit, GitHub status, export/import a JSON backup, load a sample week, erase everything.

Statuses are only ever set by you; nothing is marked done automatically.

## GitHub (optional, read-only)

1. Copy `public/daily-quest.config.example.json` to `public/daily-quest.config.json` (git-ignored).
2. Fill it in:

```json
{ "github": { "username": "you", "repos": ["owner/repo", "owner/other"], "token": "github_pat_…" } }
```

   - `repos`: up to 5. `username` can be omitted if a token is given (it is looked up). Public repos work without a token (low rate limit).
   - Use a **fine-grained token, read-only**: Issues, Pull requests and Contents/Metadata → Read, limited to those repos.
   - Optional: `apiBaseUrl` for GitHub Enterprise (`https://…`).
3. Reload. On Today, the **Issues** card lists open issues assigned to you under *Work on today* (adds the issue to today, linked). A **GitHub** panel shows:
   - **Done today:** issues assigned to you that were closed today, and your merged PRs → *Highlight* to pin them to today.
   - **My commits today** → *Highlight*.
   - If a linked goal's issue was closed on GitHub, it is tagged *Closed on GitHub* and you're offered *Mark done* (never automatic).

Notes:

- Only `GET` requests; nothing is ever written to GitHub. The token goes only in the `Authorization` header and is never stored.
- Highlights you pin are saved in your history, so past days keep their GitHub items even though GitHub is only queried for today.
- **The config file is served as a static file, so anyone who can open the app can read the token.** Run it locally or somewhere only you can reach, use a minimal read-only token, never commit it, and check `dist/` before sharing a build (`npm run build` copies `public/`).
- Reads repository issues, PRs and commits — not Projects (v2) board columns.
- "Today" is your local calendar day.

## Data folder (optional, Chrome/Edge)

In **Settings → Data folder → Choose folder**, pick a folder and your data is also saved there as Parquet files you own: `meta.parquet` plus `YYYY-MM.days.parquet`, `YYYY-MM.items.parquet` and `YYYY-MM.highlights.parquet` for each month. Open them with DuckDB, pandas or any Parquet viewer, e.g. `SELECT date, repo, number, status, note FROM '2026-10.items.parquet' WHERE kind = 'issue'`.

- Your existing browser data is written into an empty folder. If the folder already has Daily Quest data you're asked whether to use it.
- A folder that can't be read is left untouched. The browser copy stays as a cache and fallback.
- If the browser asks for permission again after a restart, use **Reconnect folder**.
- Other browsers keep using browser storage; use **Export backup** there.

## Data & versions

Saved data is `version: 3` (`src/logic/storage.ts`). Each goal is either an `issue` item (linked to a GitHub issue) or an `own` item; older v2 data is upgraded automatically and the original is kept as a backup. Unreadable data is never overwritten — a backup copy is kept and you can reset. The header shows "Saved" only when a write actually succeeded. If you used the earlier team-standup version of this app, its data is kept under a backup key and the app starts clean.

## Layout

```
src/types.ts             data models
src/logic/               days (goals, carry-over, streak), achievements, summary, github, storage, sample + tests
src/store.tsx            reducer + persistence
src/components/          Today, GitHubPanel, Screens (History, Achievements, Settings)
```

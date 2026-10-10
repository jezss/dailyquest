# Daily Quest — personal daily goals

A single-user daily goals tracker. Plan a few goals each day, tick them off, see what you got done (including real GitHub activity), and look back over your week. Runs entirely in your browser: no backend, no account. Data is saved in `localStorage`.

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

- **Today:** an intention for the day, goals (add, edit, reorder, notes, status To do / In progress / Done / Skipped, one ★ focus goal), an end-of-day reflection (win, notes, for tomorrow), a progress ring, and a **Highlights** list of what you finished.
- **Carry-over:** unfinished goals from your last day are offered once; you choose which to bring forward.
- **History:** a 7-day strip, streak (consecutive days with something done or highlighted — a quiet morning never breaks it), every past day (open and edit any), and *Copy this week*.
- **Achievements:** computed from your saved days only (First Step, Clean Sweep, Steady Three, Full Week, Focus Finisher, Shipper, Issue Closer, Reflective). Nothing unlocks unless the records show it.
- **Copy / download** a Markdown summary of any day.
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
3. Reload. A **GitHub** panel on Today shows:
   - **Assigned to me:** open issues assigned to you → *Add as goal* (linked, with a back-link).
   - **Done today:** issues assigned to you that were closed today, and your merged PRs → *Highlight* to pin them to today.
   - **My commits today** → *Highlight*.
   - If a linked goal's issue was closed on GitHub, you're offered *Mark done* (never automatic).

Notes:

- Only `GET` requests; nothing is ever written to GitHub. The token goes only in the `Authorization` header and is never stored.
- Highlights you pin are saved in your history, so past days keep their GitHub items even though GitHub is only queried for today.
- **The config file is served as a static file, so anyone who can open the app can read the token.** Run it locally or somewhere only you can reach, use a minimal read-only token, never commit it, and check `dist/` before sharing a build (`npm run build` copies `public/`).
- Reads repository issues, PRs and commits — not Projects (v2) board columns.
- "Today" is your local calendar day.

## Data & versions

Saved data is `version: 2` (`src/logic/storage.ts`). Unreadable data is never overwritten — a backup copy is kept and you can reset. The header shows "Saved" only when a write actually succeeded. If you used the earlier team-standup version of this app, its data is kept under a backup key and the app starts clean.

## Layout

```
src/types.ts             data models
src/logic/               days (goals, carry-over, streak), achievements, summary, github, storage, sample + tests
src/store.tsx            reducer + persistence
src/components/          Today, GitHubPanel, Screens (History, Achievements, Settings)
```

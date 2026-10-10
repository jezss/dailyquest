# 001 — GitHub-first days, durable notes

Status: **Draft for discussion** · Date: 2026-10-11

## Problem

Today the app is notes-first: you plan local goals, and GitHub is a side panel you can optionally pull items from. Two things feel wrong:

1. **GitHub issues should be the spine of the day.** The work already lives in issues; re-typing it as local goals duplicates it and drifts.
2. **Notes live only in `localStorage`.** They are tied to one browser profile, are lost if site data is cleared, can't be queried across months, and can't be opened in anything else.

## User stories

### Story A — Issue-driven day

> As a solo developer, I want my day to be organised around my GitHub issues, with my own daily notes layered on top, so that I plan and review against the real work instead of a parallel to-do list.

**Acceptance criteria**

- Today lists my assigned open issues (across configured repos) as the primary items, each showing repo, number, title, and local status (To do / In progress / Done / Skipped).
- Each issue has an attached **daily note** (free text, per issue per day) — "what I did / blocked on / next".
- A separate **Day note** (intention, win, reflection, for tomorrow) remains, as the second-tier layer.
- Local-only items ("own" goals) still exist for things with no issue, but are visually secondary (a "Not on GitHub" group) and can be **converted into a note on an issue** later.
- Selecting an issue to work on is an explicit user action; nothing is marked done automatically, even if the issue closed on GitHub (existing rule: suggest "Mark done" only).
- GitHub stays **read-only**: no issue is ever created, edited, commented on or closed by the app.
- History groups by issue as well as by day: opening an issue shows every daily note I wrote about it, in order.
- Summaries (Copy/Download) lead with issues worked, then own items, then reflection. Empty sections are labelled, not filled.

### Story B — Notes that outlive the browser

> As a user, I want my notes stored in a file I own, in a columnar format I can query, so they survive clearing browser data, move between machines, and can be analysed over time.

**Acceptance criteria**

- On first run (or from Settings) I **choose a folder**; the app writes my data there. No backend, no account.
- Data is saved as **Parquet** files (see Proposed design). I can open them with DuckDB, pandas, or any Parquet viewer.
- "Saved" in the header appears **only when the file write succeeded** (existing rule).
- Unreadable or newer-schema files are **never overwritten**; a backup copy is kept and I'm told.
- Existing `localStorage` data is **migrated** into the folder on first connect, with the old copy kept until I confirm.
- If the folder is unavailable (permission revoked, unsupported browser), the app falls back to `localStorage` and says so plainly.
- JSON export/import keeps working as the portable backup.

## Proposed design (to be challenged)

**Data model** — a Day keeps its shape; add an `IssueNote` keyed by `(date, repo, number)`:

| Table / file | Columns |
|---|---|
| `days` | date, focusNote, win, reflection, tomorrow, carryDismissed |
| `items` | id, date, kind (`issue` \| `own`), repo?, number?, url?, title, status, focus, note, createdAt, doneAt |
| `highlights` | id, key, date, kind, title, url, repo, at |
| `meta` | schemaVersion, savedAt, appVersion |

Issue *titles/state* are a cached snapshot of what GitHub said when I interacted with them, so history doesn't change retroactively. Notes and status are mine.

**Storage**

- Browser File System Access API (`showDirectoryPicker`); directory handle persisted in IndexedDB.
- Parquet isn't appendable, so write **one file per month per table** (`2026-10.items.parquet`), rewriting only the current month. Small files, cheap rewrites, old months stay untouched.
- Library: a small pure-JS Parquet reader/writer (e.g. `hyparquet` + `hyparquet-writer`) rather than DuckDB-WASM (several MB for what is a few thousand rows).
- Writes go to a temp name then rename, so a crash can't truncate the real file.
- `localStorage` stays as the write-through cache and fallback.

## Conflicts with current project rules (need a decision)

`AGENTS.md` currently says: no new runtime dependencies, no backend, nothing but read-only GitHub on the network. This story needs:

1. **One or two new dependencies** (Parquet read/write). Proposal: allow, since hand-rolling Parquet isn't sensible.
2. **Browser support**: File System Access API is Chromium-only (Chrome/Edge). Firefox/Safari would stay on `localStorage` + JSON export. Acceptable?
3. The `Goal` model is replaced by `items` with a `kind`; this is a **breaking schema change** → `CURRENT_VERSION = 3` plus a migration and tests.

## Open questions

1. **Is Parquet actually the goal, or is "a durable file I own" the goal?** Parquet is great for querying months of history in DuckDB but is opaque and not diff-able. A folder of Markdown/JSONL files per day would be human-readable and git-friendly. Could do Parquet as the store and Markdown as a generated export. Which do you want to *open and read* day to day?
2. **Which GitHub items count as "the day"?** Assigned open issues only, or also issues I commented on, PRs I opened, issues in a Project board? (Today's client reads issues/PRs/commits, not Projects v2.)
3. **Per-issue notes vs per-day notes** — should an issue note carry forward (a running log) or be strictly one entry per day?
4. **Where should the folder live?** Inside a synced folder (OneDrive/Dropbox) gives cross-machine sync for free, but concurrent edits from two machines could clash. Single-writer assumed?
5. **Should the data folder be a git repo the user pushes themselves?** Easy win for history, but out of scope for the app (it must not write to GitHub).

## Suggested slicing

1. **Storage seam** — abstract `loadData/saveData` behind an interface; add the folder-backed Parquet implementation and migration from `localStorage` (Story B). Ship alone; the UI doesn't change.
2. **Issue as first-class item** — schema v3, `items` with `kind`, per-issue daily note (Story A, data + logic + tests).
3. **Today UI re-orientation** — issues first, own items secondary, day note below.
4. **History by issue** and updated summaries.

## Out of scope

Writing to GitHub, multi-user sharing, a hosted backend, mobile app, real-time sync.

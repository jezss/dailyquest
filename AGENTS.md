# AGENTS.md

Guidance for AI coding agents working on **Daily Quest**, a single-user daily goals tracker (React + TypeScript + Vite, no backend). Read `README.md` for features; this file covers how to work on it safely.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest — all logic tests live in src/logic/logic.test.ts
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build
```

Run `npm run typecheck && npm test` before finishing any change. `npm run build` must also pass.

## Layout

```
src/types.ts            data models (Day, Goal, Highlight, AppData…)
src/logic/              pure, tested logic — put rules here, not in components
  days.ts               goals, carry-over, focus, pinning, stats, streak
  achievements.ts       achievements computed from saved days
  summary.ts            Markdown day/week summaries and per-issue logs (issues first, then other work, then reflection)
  github.ts             read-only GitHub client + config parsing
  storage.ts            versioned localStorage load/save/validate/migrate
  parquetCodec.ts       AppData <-> Parquet file set (pure, tested)
  folderStore.ts        folder read/write/sync over a small `Dir` interface + File System Access helpers
  sample.ts             optional sample week
  util.ts               dates (local-time ISO strings) and ids
src/store.tsx           reducer + persistence (single source of truth)
src/components/         Today, GitHubPanel, Screens (History, Achievements, Settings)
src/ui.tsx              shared buttons, cards, fields, modal, clipboard/download helpers
public/daily-quest.config.example.json   GitHub config template
```

Logic functions take and return plain data (`Day`, `AppData`); components call them through `useStore().update / updateDay`. Keep it that way so everything stays testable.

## Product rules — do not break these

- **Today is issues-first.** Assigned issues are only *offered* ("Work on today"); an issue joins a day only through an explicit click. Today splits `day.goals` by `kind` into the Issues and Not-on-GitHub lists, so reorder with `moveWithinKind`, not `moveGoal`.
- **Nothing is marked done automatically.** Goal status changes only from an explicit user action. A GitHub issue closing may *suggest* "Mark done"; it never changes the goal.
- **Achievements and streaks are derived from saved records only.** Never award or fake them. Skipped goals never count against the user; a quiet morning must not break the streak.
- **GitHub is read-only.** Only `GET` requests. Never add code that creates, edits, comments on or closes anything on GitHub.
- **Never invent data** in summaries (owners, dates, outcomes). Empty sections are labelled, not filled.
- **Never claim data is saved unless the write succeeded** (`saveData` returns a boolean; the header reflects it).
- Dates are the user's **local** calendar day (`toISODate`). Don't use `toISOString().slice(0, 10)` for day keys.
- Keep it accessible: labelled controls, visible focus, status not conveyed by colour alone, respect `prefers-reduced-motion`, usable from 375px wide.

## Persistence and migrations

- Saved data is `version: 3` under the `dailyquest.data` localStorage key. Add new fields as **optional** where possible. For a breaking change, bump `CURRENT_VERSION`, add a step to `migrateData` in `storage.ts` (it must also work for backups and the Parquet folder), and add tests.
- Unreadable data must never be overwritten (a backup is kept under `dailyquest.corrupt-backup`). Old v1 team-standup data is preserved under `dailyquest.v1-team-backup`; the untouched v2 copy under `dailyquest.v2-backup`.
- **Items:** a day's `goals` are items with `kind: 'issue' | 'own'`. `kind` always follows `source` (`newGoal` derives it; `validateData` rejects a mismatch). An issue appears at most once per day (`addIssueItem`); its `note` is that day's note about the issue, and `issueLog` / `issueIndex` read an issue's history across days. `source.state` is a snapshot of what GitHub last said, never live data and never a reason to change a goal's status. `linkToIssue` turns an own item into a note on an issue.
- **Data folder (optional, Chrome/Edge):** the user can pick a folder (File System Access API; handle kept in IndexedDB). Data is written there as Parquet — `meta.parquet` plus `YYYY-MM.{days,items,highlights}.parquet` (v2 folders used `.goals.parquet`; they are still read and the old files are removed on the next write) (`parquetCodec.ts`, `folderStore.ts`). `localStorage` stays as a write-through cache and fallback. Rules: a folder that can't be read (or was written by a newer version) is **never written to**; "Saved" with a folder connected means the folder write succeeded; only changed months are rewritten; only files matching `MANAGED_FILE` are ever deleted. A schema change must update the codec's column lists, the version check and the round-trip test.
- `validateData` is strict on purpose. If you change the `Day`/`Goal`/`Highlight` shape, update validation and the sample/test fixtures.

## GitHub integration and secrets

- Config is `public/daily-quest.config.json` (git-ignored): `{ "github": { "username", "repos": ["owner/name"], "token" } }`. It is served to the browser as a static file, so the token is visible to anyone who can open the app — it is for local/private use only.
- **Never read, print, log, commit, or paste the token** (including in tool output, test fixtures, screenshots or summaries). When checking the config, report only whether a token is present, never its value. Don't ask the user to paste it into chat.
- Never commit `public/daily-quest.config.json`. Only the `.example.json` with `YOUR_…` placeholders belongs in git. Check `git status` before committing.
- Unauthenticated GitHub allows ~60 requests/hour and each refresh uses 4 per repo. Avoid refresh loops, and mock `fetch` in tests (see `fetchActivity` tests) — tests must never hit the network.
- Links from GitHub data must pass through `safeUrl` (http/https only) and open with `rel="noopener noreferrer"`.

## Testing notes

- Add or update tests in `src/logic/logic.test.ts` for any logic change (status rules, carry-over, streaks, achievements, summary text, storage, GitHub parsing).
- Tests use fixed timestamps and pass `now` explicitly; don't depend on the real clock.
- UI has no component tests; verify UI changes in the browser (desktop, ~768px tablet and 375px phone) and check there is no horizontal scroll.

## Environment gotchas (Windows)

- Shell is PowerShell 5.1: no `&&`; chain with `;`. `Get-Content`/`Set-Content` re-encode text and have corrupted UTF-8 characters (em dashes, ellipses) before. Prefer the editor tools, or `[IO.File]::ReadAllText/WriteAllText` with `UTF8Encoding($false)`.
- If `node`/`git` are "not found" right after installing, refresh `$env:Path` from the Machine and User environment variables.
- Vite's dev server has served **stale modules** after files changed outside the editor tools. If the browser doesn't reflect an edit, restart the dev server.
- Run scripts with absolute paths; the working directory can change between commands.

## Style

- Match the surrounding code: small pure functions, explicit types, no unused imports/locals (`noUnusedLocals` is on), comments only where the *why* isn't obvious.
- No new runtime dependencies without a strong reason (current: `react`, `react-dom`, `lucide-react`, plus `hyparquet` / `hyparquet-writer` for the data folder — small pure-JS Parquet read/write, chosen over DuckDB-WASM). Icons come from `lucide-react` (it has no brand icons — don't look for a GitHub logo).
- Don't add a backend, accounts, analytics or any third-party calls. The only network access is the read-only GitHub client.

## Git

- Remote: `https://github.com/jezss/dailyquest` (branch `main`). Commit locally freely; **do not push, force-push or rewrite history unless the user asks**, and never run destructive git commands without asking first.
- The repo-local git identity uses the GitHub noreply address; don't change it or add the user's real email to commits.

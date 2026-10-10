@AGENTS.md

## Claude Code notes

- Before finishing a change: `npm run typecheck`, `npm test`, `npm run build` (all in AGENTS.md). For UI changes, also check the page in the preview at desktop and 375px width, with no horizontal scroll.
- After editing files, restart the dev server (the preview tool's stop/start) if the browser still shows old UI; Vite has served stale modules here more than once.
- The user-story behind the current design is `docs/user-stories/001-github-first-and-durable-notes.md` (GitHub issue #1): GitHub issues are the spine of a day, notes are the second layer, and data can live in a user-chosen folder as Parquet. Check it before changing the item model or storage.
- Never read, print or paste the GitHub token from `public/daily-quest.config.json`; if the user pastes one in chat, tell them to revoke it.

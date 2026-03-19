# Publishing TGI v1 to GitHub

Follow these steps to create your open source repo.

## 0. Verify before you push

From `tgi-v1-open-source` (simulates a fresh clone):

```bash
rm -rf node_modules dist
npm install
npm run verify
```

- **`npm run verify`** runs `typecheck` + `build` (same as CI should run).

**Security — before `git add`:** Run `git status` and confirm you do **not** see `.env`, `.env.local`, `data/sessions.json`, `node_modules/`, or `dist/`. If you ever ran the daemon with real keys, **rotate** Trello tokens and any other keys that might have been captured in session logs (agents can `read_file` `.env`). The repo ignores `data/*` except `data/.gitkeep` so session files stay local.

**Not the monorepo Next app:** open-source v1 has **no** frontend on port **3000**. UI is **`http://localhost:3199/dashboard`** (same server as the API).

Optional — full smoke test with real credentials (replace paths if needed):

1. Copy `.env.example` → `.env.local` and fill in keys.
2. Set a real `board_id` in `WORKFLOW.md` (not `YOUR_BOARD_ID`).
3. `npm run build && npm start` → open `http://localhost:3199/dashboard`, check `GET /api/status` shows `healthy: true` for your tracker.
4. `npm run test:trello` — hits Trello API using `WORKFLOW.md` board id.

## 1. Update repository URL

The repo is published at `https://github.com/walter-grace/TGI`. If you fork, update `package.json` `repository.url` and clone URLs in README.md / CONTRIBUTING.md to match your fork.

## 2. Initialize git and push

```bash
cd tgi-v1-open-source
git init
git add .
git commit -m "Initial v1 release: TGI open source skeleton"
git branch -M main
git remote add origin https://github.com/walter-grace/TGI.git
git push -u origin main
```

## 3. Create the repo on GitHub first (if empty)

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `TGI` (must match the remote URL)
3. Description: `TGI — TrelloGI. Tracker-agnostic AI agent orchestration for project management.`
4. Choose **Public**
5. Do **not** initialize with README (you already have one)
6. Create repository
7. Then run the git commands above

## 4. Add repo topics

On the repo page: Settings → General → Topics. Add:

- `trello`
- `ai`
- `agent`
- `automation`
- `project-management`
- `typescript`

## 5. Optional: GitHub Actions

Add a basic CI workflow later (e.g. `npm run typecheck` on push).

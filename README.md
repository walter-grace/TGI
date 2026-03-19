# TGI (TrelloGI)

> **Open-source v1 = one process only.** This repo is the **daemon** (REST API + static dashboard). There is **no Next.js app** and **no port 3000** for TGI. After `npm run dev` or `npm start`, open **`http://localhost:3199/dashboard`** (or whatever you set in `TGI_PORT` / `WORKFLOW.md` `server.port`).

**TGI** — a play on AGI. Tracker-agnostic AI agent orchestration that plugs into project management tools. Trello is the first adapter; the architecture supports Jira, Linear, GitHub Issues, and others via a single `ITracker` interface.

AI agents pick up tasks from your board, work in isolated workspaces, and report back via comments and state transitions.

## Why Trello fits agent orchestration

**The board is the runtime.** Lists are queues and stages—*ready → doing → done* maps cleanly to *enqueue → run → complete* without inventing a new job system. Humans see the same truth the daemon uses: what’s waiting, what’s running, what finished or failed.

**Markdown is the contract.** Card descriptions (and comment threads) give you structured, copy-pastable context—requirements, links, repro steps—without a rigid ticket schema. Agents read natural language specs; people can edit them in place.

**Comments are working memory.** Agents post updates to the card; the same run or a later one can **read those comments** through the tracker. You get a durable thread—plans, checklists, partial results, and handoffs—so work isn’t blind to what already happened on this issue. Trello holds that narrative; the agent pulls it when continuing.

**Orchestration stays editable.** `WORKFLOW.md` pairs the board with version-controlled setup: YAML frontmatter for boards, lists, and agent settings, plus a markdown body for the agent prompt template. One board for coordination, one file for how agents behave—easy to review and diff.

TGI stays **tracker-agnostic** (`ITracker`), but Trello is the reference adapter because **visual queue + markdown tasks + comment threads + file-based workflow** is an unusually good match for autonomous agents.

## Features

- **Trello integration** — Poll cards from "Ready For Agent", move through Doing → Done; agents read/write comments for threaded context (plans, todos, outcomes)
- **Multi-turn agent loop** — Claude/OpenRouter with tool use (read/write files, run commands, post comments)
- **REST API** — Status, sessions, assign, dashboard
- **Optional web search** — Tavily API for research tasks

## Quick Start

1. **Clone and install**
   ```bash
   git clone https://github.com/walter-grace/TGI.git
   cd TGI
   npm install
   ```

2. **Configure**
   - Copy `.env.example` to `.env.local`
   - Add Trello API key and token ([get them here](https://trello.com/power-ups/admin))
   - Edit `WORKFLOW.md` frontmatter with your board ID and list names

3. **Run**
   ```bash
   npm run dev
   ```

4. **Dashboard** — Open `http://localhost:3199/dashboard` for queue and session view (static **shadcn-style** UI: `public/dashboard.html` + `public/dashboard.css`)

### Before publishing (maintainers)

```bash
npm run verify   # typecheck + build — run this in CI before merge
```

See [GITHUB_SETUP.md](./GITHUB_SETUP.md) for the full pre-push checklist and `git push` steps.

## Configuration

### WORKFLOW.md

The frontmatter defines trackers and agent settings:

```yaml
---
trackers:
  - kind: trello
    id: "main-board"
    board_id: "YOUR_BOARD_ID"
    api_key_env: "TRELLO_API_KEY"
    api_token_env: "TRELLO_API_TOKEN"
    lists:
      ready: "Ready For Agent"
      in_progress: "Doing"
      done: "Done"

workspace:
  root: ~/workspaces/tgi
  keep_workspace: true

agent:
  provider: "openrouter"
  model: "moonshotai/kimi-k2.5"
  max_turns: 60
---
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRELLO_API_KEY` | Yes | Trello API key |
| `TRELLO_API_TOKEN` | Yes | Trello API token |
| `OPENROUTER_API_KEY` | Yes* | OpenRouter API key (*or `ANTHROPIC_API_KEY` for direct Claude) |
| `TGI_PORT` | No | Server port (default: 3199) |
| `TAVILY_API_KEY` | No | Enables `web_search` tool |

## Architecture

```
WORKFLOW.md (config)
       ↓
  Orchestrator (polls Trello, enqueues cards)
       ↓
  Agent Runner (Claude/OpenRouter, tool loop)
       ↓
  Workspace (isolated dir per card)
       ↓
  Tracker (comments, transitions)
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Daemon health |
| `GET /api/sessions` | All sessions + queue |
| `POST /api/assign` | Enqueue a card (`{ trackerId, issueId }`) |
| `GET /api/sessions/:id/logs` | SSE stream of agent logs |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

# TGI (TrelloGI)

> **Open-source v1 = one process only.** This repo is the **daemon** (REST API + static dashboard). After `npm run dev` or `npm start`, open **`http://localhost:3199/dashboard`**.

**TGI** — a play on AGI. Tracker-agnostic AI agent orchestration that plugs into project management tools. Trello is the first adapter; the architecture supports Jira, Linear, GitHub Issues, Notion, HubSpot, and others via a single `ITracker` interface.

AI agents pick up tasks from your board, work in isolated workspaces, and report back via comments and state transitions.

## What's New: Self-Healing Agents + Cloudflare Workers

### Self-Healing Code

Inspired by [Ramp Labs' self-healing system](https://www.ramplabs.com/blog/self-maintaining), TGI now includes a **self-healing agent** that monitors any GitHub repository, detects issues, and pushes fixes — all from a Trello card.

**How it works:**

1. Create a **Self-Healing** list on your Trello board
2. Drop a card with a GitHub repo URL in the description
3. An AI agent clones the repo, generates monitor scripts, runs them
4. Real failures become fix cards in "Ready For Agent" — picked up by the next available agent
5. Fix agents reproduce the issue, push a PR, and post the link on the card

The entire loop is autonomous: **Scan → Detect → Triage → Fix → Verify**

### Cloudflare Dynamic Workers

Self-healing monitors can be deployed as **Cloudflare Workers** for continuous runtime monitoring at the edge:

- Each monitor becomes a V8 isolate on Cloudflare's global network
- Workers run on **Cron Triggers** (e.g. every 5 minutes, hourly)
- When a failure is detected, the Worker POSTs to a webhook on TGI
- TGI creates a Trello fix card automatically — the loop closes itself

**New agent tools:**
- `cloudflare_deploy_worker` — Deploy a JS Worker + optional cron trigger
- `cloudflare_delete_worker` — Clean up old monitors
- `cloudflare_list_workers` — List deployed monitors
- `tracker_board_snapshot` — Full board context for deduplication

**New webhook endpoint:**
- `POST /api/webhooks/monitor` — Receives monitor results, creates fix cards

### Pipeline Canvas + MCP Server

TGI now includes a **visual pipeline builder** (Boomi-style) and an **MCP server** for building workflows programmatically:

**Pipeline Canvas** — drag-and-drop workflow builder with 21 node types across 4 categories:
- **Triggers**: Trello, Notion, Linear, GitHub, HubSpot, Webhook
- **Actions**: Run Code, Write File, Research, Browser, Comment, Create Card, Cloudflare Worker, Self-Heal
- **Outputs**: Slack, Discord, Notion Page, Git Push
- **Logic**: If Label, Experiment, Text Input

Pipelines save as JSON, execute via a DAG engine, and show **live execution state** on nodes (running/completed/failed).

**MCP Server** — build pipelines from Cursor, Claude Code, or any MCP client:
```bash
npm run mcp:workflows
```

Tools: `list_workflows`, `create_workflow`, `add_node`, `connect_nodes`, `generate_pipeline`, and more.

**AI Copilot** — a chat interface in the dashboard that uses natural language to create and run pipelines:
> "Create a pipeline that scans my TGI repo, deploys health monitors to Cloudflare, and sends failures to Slack"

---

## Why Trello fits agent orchestration

**The board is the runtime.** Lists are queues and stages—*ready → doing → done* maps to *enqueue → run → complete*. Humans see the same truth the daemon uses.

**Markdown is the contract.** Card descriptions give structured, natural language context. Agents read specs; people edit them in place.

**Comments are working memory.** Agents post updates; later runs read those comments. Durable context without a vector database.

**Orchestration stays editable.** `WORKFLOW.md` pairs the board with version-controlled config.

## Agent-agnostic: plug in your own model

TGI uses a **pluggable agent layer** (`IAgentProvider`):

| Provider | Use case |
|---------|----------|
| `openrouter` | 300+ models via one API (default) |
| `claude` | Direct Anthropic Claude |
| `openai` | Any OpenAI-compatible endpoint — Azure, Bedrock, vLLM, Ollama |

## Features

- **Trello integration** — Poll cards, move through lists, read/write comments
- **Self-healing agents** — Monitor repos, generate tests, triage failures, push fixes
- **Cloudflare Workers** — Deploy runtime monitors at the edge with cron triggers
- **Pipeline canvas** — Visual workflow builder with live execution
- **MCP server** — Build pipelines programmatically from any MCP client
- **AI copilot** — Natural language chat to create and run pipelines
- **Multi-turn agent loop** — Pluggable providers with tool use
- **Board snapshot** — Full Trello board context for deduplication
- **REST API** — Status, sessions, workflows, webhooks
- **Optional web search** — Browserbase, Firecrawl, or Tavily

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

4. **Dashboard** — Open `http://localhost:3199/dashboard`

### Self-Healing Setup

1. Add to `WORKFLOW.md` under your Trello tracker lists:
   ```yaml
   self_healing: "Self-Healing"
   ```
2. Add to skills label_map:
   ```yaml
   self-heal: ["git", "code", "test", "debug", "self-heal", "self-heal-fix"]
   ```
3. Create a "Self-Healing" list on your Trello board
4. Drop a card with a repo URL — the agent handles the rest

### Cloudflare Workers Setup

Add to `.env.local`:
```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
MONITOR_WEBHOOK_SECRET=your_secret
```

The self-heal agent will automatically deploy runtime monitors as Workers when it detects deployed services.

### MCP Server

```bash
npm run mcp:workflows   # Start MCP server (stdio)
```

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "tgi-workflows": {
      "command": "npx",
      "args": ["tsx", "src/mcp/workflow-server.ts"]
    }
  }
}
```

## Configuration

### WORKFLOW.md

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
      self_healing: "Self-Healing"

workspace:
  root: ~/workspaces/tgi
  keep_workspace: true

agent:
  provider: "openrouter"
  model: "moonshotai/kimi-k2.5"
  max_concurrent_agents: 8
  max_turns: 60

skills:
  directory: ".symphony/skills"
  default: ["git", "code"]
  label_map:
    self-heal: ["git", "code", "test", "debug", "self-heal", "self-heal-fix"]
    research: ["git", "code", "research", "web-search"]
    bug: ["git", "code", "test", "debug"]
---
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TRELLO_API_KEY` | Yes | Trello API key |
| `TRELLO_API_TOKEN` | Yes | Trello API token |
| `OPENROUTER_API_KEY` | Yes* | OpenRouter key (*or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `CLOUDFLARE_ACCOUNT_ID` | No | For Cloudflare Worker monitors |
| `CLOUDFLARE_API_TOKEN` | No | For Cloudflare Worker monitors |
| `MONITOR_WEBHOOK_SECRET` | No | Shared secret for monitor webhook auth |
| `BROWSERBASE_API_KEY` | No | Cloud browser for web search |
| `TAVILY_API_KEY` | No | Alternative web search |
| `TGI_PORT` | No | Server port (default: 3199) |

## Architecture

```
WORKFLOW.md (config + prompt template)
       ↓
  Orchestrator (polls all trackers every 30s)
       ↓
  Agent Runner (multi-turn LLM loop with tools)
       ↓                          ↓
  Workspace (isolated dir)    Cloudflare Workers (edge monitors)
       ↓                          ↓
  Tracker (comments, transitions)  Webhook → Trello fix cards
       ↓
  Pipeline Canvas (visual builder)
       ↓
  MCP Server (programmatic pipeline management)
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Daemon health, connected trackers |
| `GET /api/sessions` | All sessions + queue |
| `GET /api/sessions/:id/logs` | SSE stream of agent logs |
| `POST /api/assign` | Enqueue a card |
| `GET /api/workflows` | List saved pipelines |
| `POST /api/workflows` | Create pipeline |
| `PUT /api/workflows/:id` | Save pipeline |
| `POST /api/workflows/:id/run` | Execute pipeline |
| `GET /api/workflows/:id/runs/:runId/stream` | SSE stream of pipeline execution |
| `POST /api/webhooks/monitor` | Receive Cloudflare Worker monitor results |
| `POST /api/chat` | AI copilot (SSE stream) |

## Skills

Skills are markdown files in `.symphony/skills/` that define agent capabilities. Key skills:

| Skill | Purpose |
|-------|---------|
| `self-heal.md` | Scan repos, generate monitors, triage failures, create fix cards |
| `self-heal-fix.md` | Reproduce and fix issues detected by monitors |
| `code.md` | Read/write files, run commands |
| `git.md` | Git operations |
| `test.md` | Run tests, validate changes |
| `browserbase.md` | Cloud browser automation |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

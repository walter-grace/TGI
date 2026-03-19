# Contributing to TGI

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/walter-grace/TGI.git
cd TGI
npm install
cp .env.example .env.local
# Edit .env.local with your credentials
npm run dev
```

## Project Structure

```
src/
├── agent/          # LLM loop, tools, prompt builder
├── config/         # Workflow loader, types
├── orchestrator/   # Polling, queue, session management
├── server/         # Express API, routes
├── tracker/        # Trello adapter (ITracker impl)
├── workspace/      # Workspace creation, hooks
└── index.ts        # Entry point
```

## Adding a New Tracker

1. Implement `ITracker` in `src/tracker/adapters/`
2. Register in `src/tracker/registry.ts`
3. Add config schema in `src/config/types.ts`
4. Update WORKFLOW.md docs

## Adding a Custom Agent Provider

1. Implement `IAgentProvider` in `src/agent/providers/` (see `interface.ts`)
2. Register before the daemon starts:
   ```ts
   import { registerProvider } from "./agent/providers/registry.js";
   registerProvider("my-company", (config) => new MyCompanyProvider(config.agent));
   ```
3. Use `provider: "my-company"` in WORKFLOW.md

## Code Style

- TypeScript strict mode
- Prefer `async/await` over raw Promises
- Use `logger` from `observability/logger` for output

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm run typecheck` and `npm run build`
5. Open a PR with a clear description

## Questions?

Open an issue for discussion.

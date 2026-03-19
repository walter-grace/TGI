# TGI Setup Guide

## 1. Trello API Credentials

1. Go to [Trello Power-Up Admin](https://trello.com/power-ups/admin)
2. Create or select an app
3. Copy **API Key** and **Token** (generate under "Token" section)
4. Add to `.env.local`:
   ```
   TRELLO_API_KEY=your_key
   TRELLO_API_TOKEN=your_token
   ```

## 2. Board Configuration

1. Open your Trello board
2. Copy the board ID from the URL: `https://trello.com/b/BOARD_ID/board-name`
3. Create a list named **"Ready For Agent"** (or your preferred name)
4. Edit `WORKFLOW.md` frontmatter:
   ```yaml
   trackers:
     - kind: trello
       board_id: "YOUR_BOARD_ID"
       lists:
         ready: "Ready For Agent"
         in_progress: "Doing"
         done: "Done"
   ```

## 3. LLM Provider

**Option A: OpenRouter** (recommended — 300+ models)

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Create an API key
3. Add to `.env.local`: `OPENROUTER_API_KEY=sk-or-v1-...`
4. In WORKFLOW.md: `provider: "openrouter"`, `model: "moonshotai/kimi-k2.5"`

**Option B: Anthropic direct**

1. Get API key from [console.anthropic.com](https://console.anthropic.com)
2. Add: `ANTHROPIC_API_KEY=sk-ant-...`
3. In WORKFLOW.md: `provider: "claude"`

**Option C: OpenAI-compatible (Azure, vLLM, Bedrock proxy, etc.)**

1. Set your API key env (e.g. `OPENAI_API_KEY` or `AZURE_OPENAI_KEY`)
2. In WORKFLOW.md:
   ```yaml
   agent:
     provider: "openai"
     model: "gpt-4o"  # or your deployment name
     api_key_env: "OPENAI_API_KEY"
     base_url: "https://api.openai.com/v1"  # or your endpoint
   ```

## 4. Workspace Directory

Create the workspace root (or it will be created on first run):

```bash
mkdir -p ~/workspaces/tgi
```

Update `WORKFLOW.md` if you use a different path:

```yaml
workspace:
  root: ~/workspaces/tgi
```

## 5. Run

```bash
npm run dev
```

Add a card to "Ready For Agent" and watch the dashboard at `http://localhost:3199/dashboard`.

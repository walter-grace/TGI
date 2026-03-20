# Browserbase — Cloud browser automation

Use Browserbase for interactive web browsing when `browserbase_fetch` (static HTML) or `browserbase_search` (web search) are not enough.

## When to use

- **browserbase_fetch** — Quick HTML retrieval, no JS. Use for simple pages.
- **browserbase_search** — Web search. Use for finding links and summaries.
- **browserbase_session** — Full browser. Use when you need to click, type, fill forms, or handle JS-heavy pages.

## Workflows

### A. Session + act (agent-browser)

1. **Create session** — Call `browserbase_session` with optional `url`. You get `sessionId`, `connectUrl`, `liveUrl`.
2. **Control** — Use `browserbase_session_act` with `session_id` and action: `snapshot`, `navigate <url>`, `click @eN`, `fill @eN "value"`, `type @eN "text"`, `screenshot path.png`.
3. **Release** — Call `browserbase_session_close` with `session_id`.

### B. Browse CLI (alternative)

Use `browserbase_browse` when you prefer the official Browserbase CLI. Actions: `open <url>`, `snapshot`, `click @ref`, `fill @ref "value"`, `type @ref "text"`, `stop`. Run `open` first, then `snapshot` to get refs, then interact. Call `stop` when done.

### C. Stagehand (AI-powered)

Use `browserbase_stagehand_act` or `browserbase_stagehand_extract` with an existing `session_id` for natural-language actions. Requires GEMINI_API_KEY or OPENAI_API_KEY.

### D. MCP (when enabled)

Set `ENABLE_BROWSERBASE_MCP=1` to use `mcp_browserbase_call` with tool names: create_session, close_session, navigate, act, extract, observe, screenshot, get_url.

## Interactive session workflow (A)

1. **Create session** — Call `browserbase_session` with optional `url` (e.g. `https://google.com`). You get `sessionId`, `connectUrl`, `liveUrl`. The live view appears in the dashboard.
2. **Control the browser** — Use `browserbase_session_act` with the `session_id` and an action:
   - `snapshot` — Get the accessibility tree with element refs (`@e1`, `@e2`, …)
   - `snapshot -i` — Interactive elements only
   - `navigate https://example.com` — Go to a URL
   - `click @e3` — Click element by ref from snapshot
   - `fill @e5 "search query"` — Fill an input
   - `type @e5 "text"` — Type into an element
   - `screenshot out.png` — Capture screenshot
3. **Release when done** — Call `browserbase_session_close` with the `session_id` to stop charges.

## Example: Google Flights search

```
1. browserbase_session with url: "https://google.com"
2. browserbase_session_act session_id: "..." action: "snapshot"
3. From snapshot, find the search input ref (e.g. @e5)
4. browserbase_session_act action: "fill @e5 \"flights Santa Ana to New York March 1-3\""
5. browserbase_session_act action: "click @e7"  (search button)
6. browserbase_session_act action: "snapshot"  (see results)
7. browserbase_session_close with session_id
```

## Docs

- [Browserbase docs](https://docs.browserbase.com/llms.txt) — Full index
- [Using a session](https://docs.browserbase.com/fundamentals/using-browser-session) — Connect via Playwright/Puppeteer
- [Agent Browser](https://docs.browserbase.com/integrations/agent-browser/quickstart) — CLI we use for `browserbase_session_act`


/**
 * Tool definitions for agent — tracker-generic (tracker_comment, tracker_transition, etc.).
 * https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import type { ToolDefinition } from "./providers/interface.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "execute_command",
    description: "Execute a shell command in the workspace directory",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read contents of a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from workspace root" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from workspace root" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "tracker_comment",
    description: "Post a comment on the source ticket in the tracker",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Comment text" },
      },
      required: ["text"],
    },
  },
  {
    name: "tracker_transition",
    description: "Move the issue to a new state in the source tracker",
    input_schema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description:
            "Target state: in_progress, review, done, failed, blocked. Use blocked when stuck with no path forward.",
        },
      },
      required: ["state"],
    },
  },
  {
    name: "tracker_check_item",
    description:
      "Check or uncheck a checklist item. IMPORTANT: Only check an item (checked: true) AFTER you have completed the work for that item. Never check items before doing the work. Use item ID from issue.checklist or the item name (matched case-insensitively).",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "Checklist item ID (e.g. 69b8a...) or item name for lookup",
        },
        checked: { type: "boolean", description: "Whether the item is checked. Set true only after completing the work." },
      },
      required: ["item_id", "checked"],
    },
  },
  {
    name: "tracker_add_checklist_item",
    description:
      "Add a new checklist item to the source ticket. Use when the task asks you to add items to a checklist. Creates the item unchecked; use tracker_check_item to check it only after completing that item's work.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name of the checklist item (e.g. 'SSE: Pros: simple, Cons: one-way only')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "tracker_create_card",
    description:
      "Create a new card in the tracker. Use when breaking work into subtasks, adding follow-ups, or creating tasks for yourself. Put new cards in the Ready For Agent list so they get picked up, unless you are intentionally creating an index card in a dedicated list like `Skills`.",
    input_schema: {
      type: "object",
      properties: {
        list_name: {
          type: "string",
          description:
            "List name (e.g. Ready For Agent, Doing, Done). Use Ready For Agent for new tasks.",
        },
        title: { type: "string", description: "Card title" },
        description: {
          type: "string",
          description: "Optional card description",
        },
      },
      required: ["list_name", "title"],
    },
  },
  {
    name: "tracker_create_list",
    description:
      "Create a new list on the board. Use when organizing work into new columns.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name" },
      },
      required: ["name"],
    },
  },
  {
    name: "notion_write_page",
    description:
      "Write a rich page to Notion. Converts markdown to Notion blocks (headings, lists, to-dos, quotes, dividers). Great for publishing research, documentation, or reports. Requires NOTION_API_KEY and a Notion tracker.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title" },
        markdown: {
          type: "string",
          description:
            "Page content in markdown. Supports headings (#/##/###), bullet lists (- ), numbered lists (1. ), to-do items (- [ ] / - [x] ), blockquotes (> ), and dividers (---).",
        },
        parent_page_id: {
          type: "string",
          description:
            "Optional: create as a sub-page of this page ID instead of in the database root.",
        },
      },
      required: ["title", "markdown"],
    },
  },
  {
    name: "notion_search",
    description:
      "Search Notion pages by query. Returns matching page titles, IDs, and URLs. Requires NOTION_API_KEY and a Notion tracker.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (1-100, default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web. Uses Firecrawl (if FIRECRAWL_API_KEY set) or Tavily (if TAVILY_API_KEY set). Prefer firecrawl_search for richer content.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "firecrawl_search",
    description:
      "Search the web with Firecrawl. Returns URLs, titles, descriptions, and optionally scraped markdown. Requires FIRECRAWL_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (1-100, default 5)" },
        scrape: { type: "boolean", description: "Scrape full markdown for each result (default true)" },
      },
      required: ["query"],
    },
  },
  {
    name: "firecrawl_scrape",
    description:
      "Scrape a URL and extract content as markdown. Use for reading docs, articles, or any webpage. Requires FIRECRAWL_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
        only_main_content: { type: "boolean", description: "Extract only main content, skip nav/footer (default true)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_cdp",
    description:
      "Interact with your live Chrome session via chrome-cdp-skill. List tabs, take screenshots, get page content, click, type. Enable chrome://inspect/#remote-debugging first. Target is a prefix of the tab ID from 'list'.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Command: list | shot <target> | snap <target> | html <target> [selector] | nav <target> <url> | click <target> <selector> | type <target> <text>",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "browserbase_fetch",
    description:
      "Fetch webpage content via Browserbase (cloud). No browser session needed. Returns raw HTML. Use for quick page retrieval. 1MB limit, no JS execution. Requires BROWSERBASE_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        allow_redirects: { type: "boolean", description: "Follow HTTP redirects (default false)" },
        proxies: { type: "boolean", description: "Use Browserbase proxy network if site blocks requests (default false)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browserbase_search",
    description:
      "Web search via Browserbase. Returns structured results (title, URL). 1-25 results. Requires BROWSERBASE_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        num_results: { type: "number", description: "Number of results (1-25, default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "browserbase_session",
    description:
      "Create a cloud browser session via Browserbase. Returns sessionId, connectUrl, liveUrl. Pass url to open a page initially. Then use browserbase_session_act to control (snapshot, click, fill, navigate). Call browserbase_session_close when done. Requires BROWSERBASE_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional: navigate to this URL after creating the session" },
        timeout: { type: "number", description: "Session timeout in seconds (60-21600, default 300)" },
      },
    },
  },
  {
    name: "browserbase_session_act",
    description:
      "Control an existing Browserbase session. Use session_id from browserbase_session. Actions: snapshot (get element refs @e1, @e2), snapshot -i (interactive only), navigate <url>, click @eN, fill @eN \"value\", type @eN \"text\", screenshot path.png. Run snapshot first to get refs, then click/fill using those refs.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from browserbase_session result" },
        action: {
          type: "string",
          description:
            "Action: snapshot | snapshot -i | navigate <url> | click @eN | fill @eN \"value\" | type @eN \"text\" | screenshot path.png",
        },
      },
      required: ["session_id", "action"],
    },
  },
  {
    name: "browserbase_session_close",
    description:
      "Release a Browserbase session. Call with session_id from browserbase_session result when done. Stops the browser and avoids extra charges. Use to escape browser mode.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from browserbase_session result" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "browserbase_browse",
    description:
      "Browserbase browse CLI — alternative to session+act. Actions: open <url>, snapshot, click @ref, fill @ref \"value\", type @ref \"text\", stop. Run open first, then snapshot to get refs, then click/fill. Call stop when done. Uses daemon; commands persist across calls.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Action: open <url> | snapshot | click @ref | fill @ref \"value\" | type @ref \"text\" | stop",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "browserbase_stagehand_act",
    description:
      "AI-powered browser action via Stagehand. Use session_id from browserbase_session. Pass natural language instruction (e.g. 'click the search button'). Requires GEMINI_API_KEY or OPENAI_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from browserbase_session" },
        instruction: { type: "string", description: "Natural language instruction (e.g. 'click the search button')" },
      },
      required: ["session_id", "instruction"],
    },
  },
  {
    name: "browserbase_stagehand_extract",
    description:
      "Extract structured data from page via Stagehand. Use session_id from browserbase_session. Pass instruction and schema (JSON object with field descriptions). Requires GEMINI_API_KEY or OPENAI_API_KEY.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from browserbase_session" },
        instruction: { type: "string", description: "What to extract (e.g. 'extract the title and price')" },
        schema: {
          type: "string",
          description: "JSON schema of fields to extract, e.g. {\"title\":\"string\",\"price\":\"number\"}",
        },
      },
      required: ["session_id", "instruction", "schema"],
    },
  },
  {
    name: "mcp_browserbase_call",
    description:
      "Call Browserbase MCP server tools. Tool names: create_session, close_session, navigate, act, extract, observe, screenshot, get_url. Pass tool_name and args as JSON object. Requires ENABLE_BROWSERBASE_MCP and MCP server running.",
    input_schema: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "MCP tool: create_session, close_session, navigate, act, extract, observe, screenshot, get_url",
        },
        args: {
          type: "string",
          description: "JSON object of arguments for the tool",
        },
      },
      required: ["tool_name", "args"],
    },
  },
  {
    name: "cloudflare_deploy_worker",
    description:
      "Deploy a JavaScript ES module Worker to Cloudflare. Optionally set a cron trigger for scheduled execution. Returns the live worker URL. Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Use for deploying self-heal runtime monitors.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Worker script name (lowercase, hyphens ok). Prefix with 'sh-monitor-' for self-heal monitors.",
        },
        script: {
          type: "string",
          description:
            "Full JavaScript ES module source. Must export default { fetch?, scheduled? }.",
        },
        cron: {
          type: "string",
          description:
            "Optional cron expression for scheduled execution (e.g. '0 * * * *' for hourly, '*/5 * * * *' for every 5 min).",
        },
      },
      required: ["name", "script"],
    },
  },
  {
    name: "cloudflare_delete_worker",
    description:
      "Delete a Cloudflare Worker by name. Use to clean up old self-heal monitors.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Worker script name to delete." },
      },
      required: ["name"],
    },
  },
  {
    name: "cloudflare_execute",
    description:
      "Execute JavaScript code on Cloudflare's edge. Deploys code to a sandbox Worker, runs it, returns the result. The code must return a Response (e.g. 'return Response.json({ result: 42 })'). Use for isolated code execution, API calls from the edge, or testing. Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute. Must return a Response object. E.g.: return Response.json({ hello: 'world' })",
        },
        task_id: {
          type: "string",
          description: "Optional task identifier for tracking.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "cloudflare_list_workers",
    description:
      "List all deployed Cloudflare Workers. Use to see existing monitors before deploying new ones.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tracker_board_snapshot",
    description:
      "Get a full snapshot of the Trello board: all lists, cards, labels, checklists, and recent comments. Use BEFORE creating fix cards to check for duplicates, see what's already being worked on, and understand patterns in past failures. Returns a condensed summary.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

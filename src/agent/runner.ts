/**
 * Multi-turn agent loop with tool execution.
 * Pattern: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Issue } from "../config/types.js";
import type { ITracker } from "../tracker/interface.js";
import type { TrackerRegistry } from "../tracker/registry.js";
import { NotionAdapter } from "../tracker/adapters/notion.js";
import type { WorkflowConfig } from "../config/types.js";
import { buildPrompt } from "./prompt-builder.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import type { IAgentProvider, AgentMessage } from "./providers/interface.js";
import { createProvider } from "./providers/registry.js";
import { runInDir } from "../utils/shell.js";
import { logger } from "../observability/logger.js";
import { runExperimentLoop } from "./experiment.js";

// --- Cloudflare API ---
const CF_API = "https://api.cloudflare.com/client/v4";

function cfCreds(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return null;
  return { accountId, token };
}

export interface RunResult {
  status: "completed" | "failed" | "stopped";
  turnCount: number;
  logs: string[];
  error?: string;
  experimentLog?: import("../config/types.js").ExperimentLogEntry[];
  tokenUsage?: import("../config/types.js").TokenUsage;
}

export interface ExperimentContext {
  iteration: number;
  previousReverted: boolean;
}

export interface RunOptions {
  workspacePath: string;
  issue: Issue;
  tracker: ITracker;
  registry: TrackerRegistry;
  config: WorkflowConfig;
  templateBody: string;
  maxTurns: number;
  attempt?: number;
  onLog?: (line: string) => void;
  onMeta?: MetaCallback;
  signal?: AbortSignal;
  experimentContext?: ExperimentContext;
}

function estimateTokens(msg: AgentMessage): number {
  if (typeof msg.content === "string") return Math.ceil(msg.content.length / 4);
  return msg.content.reduce((acc, b) => {
    if (b.type === "text") return acc + Math.ceil((b as { text: string }).text.length / 4);
    if (b.type === "tool_result") return acc + Math.ceil((b as { content: string }).content.length / 4);
    if (b.type === "tool_use") return acc + 50;
    return acc;
  }, 0);
}

function truncateToTokenLimit(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
  if (messages.length <= 1) return messages;
  const total = messages.reduce((acc, m) => acc + estimateTokens(m), 0);
  if (total <= maxTokens) return messages;

  const promptTokens = estimateTokens(messages[0]);
  let tokens = promptTokens;
  const recent: AgentMessage[] = [];
  for (let i = messages.length - 1; i >= 1; i--) {
    const t = estimateTokens(messages[i]);
    if (tokens + t > maxTokens - 1000) break;
    recent.unshift(messages[i]);
    tokens += t;
  }
  const truncated = messages.length - 1 - recent.length;
  return [
    messages[0],
    {
      role: "user" as const,
      content: truncated > 0
        ? `[${truncated} prior turns truncated to stay within context limit. Continue from here.]`
        : "[Continue from here.]",
    },
    ...recent,
  ];
}

async function firecrawlSearch(
  key: string,
  query: string,
  limit: number,
  scrape: boolean
): Promise<string> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: scrape ? { formats: ["markdown"] } : undefined,
      }),
    });
    if (!res.ok) return `Error: Firecrawl search ${res.status} ${await res.text()}`;
    const data = (await res.json()) as {
      data?: Array<{ title?: string; url?: string; markdown?: string; description?: string }> | { web?: Array<{ title?: string; url?: string; markdown?: string }> };
    };
    const raw = data.data;
    const items = Array.isArray(raw) ? raw : raw?.web ?? [];
    if (items.length === 0) return `No results for "${query}"`;
    return items
      .map((r, i) => {
        const content = r.markdown ?? (r as { description?: string }).description ?? "";
        return `[${i + 1}] ${r.title ?? "Untitled"}\n${r.url ?? ""}\n${content}`;
      })
      .join("\n\n");
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function firecrawlScrape(key: string, url: string, onlyMainContent: boolean): Promise<string> {
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent,
      }),
    });
    if (!res.ok) return `Error: Firecrawl scrape ${res.status} ${await res.text()}`;
    const data = (await res.json()) as { data?: { markdown?: string } };
    return data.data?.markdown ?? "No content extracted";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function tavilySearch(key: string, query: string): Promise<string> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });
    if (!res.ok) return `Error: Tavily ${res.status} ${await res.text()}`;
    const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
    const results = data.results ?? [];
    if (results.length === 0) return `No results for "${query}"`;
    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content ?? ""}`)
      .join("\n\n");
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseFetch(
  key: string,
  url: string,
  allowRedirects: boolean,
  proxies: boolean
): Promise<string> {
  try {
    const res = await fetch("https://api.browserbase.com/v1/fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": key,
      },
      body: JSON.stringify({ url, allowRedirects, proxies }),
    });
    if (!res.ok) return `Error: Browserbase fetch ${res.status} ${await res.text()}`;
    const data = (await res.json()) as { content?: string; statusCode?: number };
    return data.content ?? `Status: ${data.statusCode ?? "unknown"}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseSearch(key: string, query: string, numResults: number): Promise<string> {
  try {
    const res = await fetch("https://api.browserbase.com/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": key,
      },
      body: JSON.stringify({ query, numResults }),
    });
    if (!res.ok) return `Error: Browserbase search ${res.status} ${await res.text()}`;
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string }> };
    const items = data.results ?? [];
    if (items.length === 0) return `No results for "${query}"`;
    return items
      .map((r, i) => `[${i + 1}] ${r.title ?? "Untitled"}\n${r.url ?? ""}`)
      .join("\n\n");
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseCreateSession(
  key: string,
  projectId: string,
  url?: string,
): Promise<{ sessionId: string; connectUrl: string; liveUrl: string } | string> {
  try {
    const res = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": key,
      },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) return `Error: Browserbase session create ${res.status} ${await res.text()}`;
    const data = (await res.json()) as { id: string; connectUrl?: string };
    const sessionId = data.id;
    const connectUrl =
      data.connectUrl ?? `wss://connect.browserbase.com?apiKey=${key}&sessionId=${sessionId}`;

    let liveUrl = `https://www.browserbase.com/sessions/${sessionId}`;
    try {
      const debugRes = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`, {
        headers: { "X-BB-API-Key": key },
      });
      if (debugRes.ok) {
        const debug = (await debugRes.json()) as { debuggerFullscreenUrl?: string };
        if (debug.debuggerFullscreenUrl) liveUrl = debug.debuggerFullscreenUrl;
      }
    } catch {
      // fallback to dashboard URL
    }

    if (url) {
      try {
        const navRes = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/navigate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-BB-API-Key": key,
          },
          body: JSON.stringify({ url }),
        });
        if (!navRes.ok) {
          // navigation endpoint may not exist; agent can navigate via CDP instead
        }
      } catch {
        // ignore — agent will navigate via CDP
      }
    }

    return { sessionId, connectUrl, liveUrl };
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseReleaseSession(
  key: string,
  sessionId: string,
): Promise<string> {
  try {
    const res = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": key,
      },
      body: JSON.stringify({ status: "REQUEST_RELEASE" }),
    });
    if (!res.ok) return `Error: Browserbase release ${res.status} ${await res.text()}`;
    return "Session released. Browser will close shortly.";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseSessionAct(
  key: string,
  sessionId: string,
  action: string,
): Promise<string> {
  try {
    const sessionRes = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      headers: { "X-BB-API-Key": key },
    });
    if (!sessionRes.ok) {
      return `Error: Cannot get session ${sessionId}: ${sessionRes.status} ${await sessionRes.text()}`;
    }
    const sessionData = (await sessionRes.json()) as { connectUrl?: string };
    const connectUrl =
      sessionData.connectUrl ??
      `wss://connect.browserbase.com?apiKey=${encodeURIComponent(key)}&sessionId=${sessionId}`;
    const { spawnSync } = await import("node:child_process");
    const parts = action.trim().split(/\s+/).filter(Boolean);
    const args = ["--cdp", connectUrl, ...parts];
    const result = spawnSync("npx", ["agent-browser", ...args], {
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, BROWSERBASE_API_KEY: key },
    });
    const out = result.stdout?.trim() ?? "";
    const err = result.stderr?.trim() ?? "";
    if (result.status !== 0) {
      return `Error: agent-browser ${result.status}\n${err || out}\n${err ? `stderr: ${err}` : ""}`;
    }
    return out || "OK";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseBrowse(key: string, projectId: string, action: string): Promise<string> {
  try {
    const { spawnSync } = await import("node:child_process");
    const env = { ...process.env, BROWSERBASE_API_KEY: key, BROWSERBASE_PROJECT_ID: projectId };
    const parts = action.trim().split(/\s+/).filter(Boolean);
    const cmd = parts[0];
    const args = parts.slice(1);
    const result = spawnSync("npx", ["@browserbasehq/browse-cli", cmd, ...args], {
      encoding: "utf-8",
      timeout: 60_000,
      env,
    });
    const out = result.stdout?.trim() ?? "";
    const err = result.stderr?.trim() ?? "";
    if (result.status !== 0) return `Error: browse ${result.status}\n${err || out}`;
    return out || "OK";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseStagehandAct(
  key: string,
  sessionId: string,
  instruction: string,
  modelApiKey: string,
): Promise<string> {
  try {
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!projectId) return "Error: BROWSERBASE_PROJECT_ID required";
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: key,
      projectId,
      browserbaseSessionID: sessionId,
      model: { modelName: "gemini-2.0-flash", apiKey: modelApiKey },
    });
    await stagehand.init();
    await stagehand.act(instruction);
    await stagehand.close();
    return "OK";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserbaseStagehandExtract(
  key: string,
  sessionId: string,
  instruction: string,
  schemaStr: string,
  modelApiKey: string,
): Promise<string> {
  try {
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!projectId) return "Error: BROWSERBASE_PROJECT_ID required";
    const schema = JSON.parse(schemaStr) as Record<string, string>;
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const { z } = await import("zod/v3");
    const zodShape: Record<string, ReturnType<typeof z.string> | ReturnType<typeof z.number>> = {};
    for (const [k, v] of Object.entries(schema)) {
      zodShape[k] = v === "number" ? z.number() : z.string();
    }
    const extractSchema = z.object(zodShape);

    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: key,
      projectId,
      browserbaseSessionID: sessionId,
      model: { modelName: "gemini-2.0-flash", apiKey: modelApiKey },
    });
    await stagehand.init();
    const result = await stagehand.extract(instruction, extractSchema);
    await stagehand.close();
    return JSON.stringify(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function mcpBrowserbaseCall(toolName: string, argsStr: string): Promise<string> {
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const key = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!key || !projectId) return "Error: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required";
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["@browserbasehq/mcp-server-browserbase"],
      env: { ...process.env, BROWSERBASE_API_KEY: key, BROWSERBASE_PROJECT_ID: projectId },
    });
    const client = new Client({ name: "trellca", version: "1.0.0" });
    await client.connect(transport);
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    const result = (await client.callTool({ name: toolName, arguments: args })) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    await transport.close();
    const content = result.content?.[0];
    return content && typeof content === "object" && "text" in content ? String(content.text) : JSON.stringify(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function browserCdp(command: string): Promise<string> {
  try {
    const { spawnSync } = await import("node:child_process");
    const skillDir = resolve(process.cwd(), "skills", "chrome-cdp");
    const script = join(skillDir, "scripts", "cdp.mjs");
    const { existsSync } = await import("node:fs");
    if (!existsSync(script)) {
      return `Error: chrome-cdp-skill not found at ${skillDir}. Clone https://github.com/pasky/chrome-cdp-skill and copy skills/chrome-cdp/ here.`;
    }
    const parts = command.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "Error: command required (e.g. list, shot <target>)";
    const result = spawnSync("node", [script, ...parts], {
      cwd: skillDir,
      timeout: 60000,
      encoding: "utf8",
    });
    const out = (result.stdout || result.stderr || "").trim();
    if (result.status !== 0 && !out) return `Error: exit code ${result.status}`;
    return out || "Done";
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export type MetaCallback = (meta: Record<string, unknown>) => void;

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    workspacePath: string;
    issue: Issue;
    tracker: ITracker;
    onMeta?: MetaCallback;
  }
): Promise<string> {
  const { workspacePath, issue, tracker, onMeta } = ctx;

  switch (name) {
    case "execute_command": {
      const command = input.command as string;
      const result = await runInDir(workspacePath, command);
      return JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      });
    }
    case "read_file": {
      const path = input.path as string;
      if (path == null || typeof path !== "string" || path === "") {
        return "Error: path is required and must be a non-empty string";
      }
      const expanded = path.startsWith("~") ? path.replace(/^~/, homedir()) : path;
      const fullPath = resolve(workspacePath, expanded);
      const wsRoot = resolve(workspacePath);
      if (!fullPath.startsWith(wsRoot + "/") && fullPath !== wsRoot) {
        return "Error: path must be within workspace";
      }
      const content = readFileSync(fullPath, "utf-8");
      return content;
    }
    case "write_file": {
      const path = input.path as string;
      const content = input.content as string;
      if (path == null || typeof path !== "string" || path === "") {
        return "Error: path is required and must be a non-empty string";
      }
      if (content == null || typeof content !== "string") {
        return "Error: content is required and must be a string";
      }
      const expanded = path.startsWith("~") ? path.replace(/^~/, homedir()) : path;
      const fullPath = resolve(workspacePath, expanded);
      const wsRoot = resolve(workspacePath);
      if (!fullPath.startsWith(wsRoot + "/") && fullPath !== wsRoot) {
        return "Error: path must be within workspace";
      }
      writeFileSync(fullPath, content, "utf-8");
      onMeta?.({ writtenFile: fullPath });
      return "OK";
    }
    case "tracker_comment": {
      const text = input.text as string;
      await tracker.postComment(issue.id, text);
      return "Comment posted";
    }
    case "tracker_transition": {
      const state = input.state as string;
      await tracker.transitionTo(issue.id, state as "in_progress" | "review" | "done" | "failed" | "blocked");
      return `Transitioned to ${state}`;
    }
    case "tracker_check_item": {
      const raw = input.item_id as string;
      const checked = input.checked as boolean;
      if (!raw || typeof raw !== "string") {
        return "Error: item_id is required";
      }
      // Trello IDs are 24 hex chars; agents often pass checklist item name instead
      const byId = issue.checklist.find((c) => c.id === raw);
      const byName = issue.checklist.find((c) => c.name === raw || c.name.toLowerCase() === raw.toLowerCase());
      const itemId = byId?.id ?? byName?.id ?? raw;
      await tracker.updateChecklist(issue.id, itemId, checked);
      return checked ? "Item checked" : "Item unchecked";
    }
    case "tracker_add_checklist_item": {
      const name = input.name as string;
      if (!name || typeof name !== "string") {
        return "Error: name is required";
      }
      if (!tracker.addChecklistItem) {
        return "This tracker does not support adding checklist items";
      }
      const created = await tracker.addChecklistItem(issue.id, name);
      return `Added checklist item "${created.name}" (id: ${created.id}). Use tracker_check_item to check it only after completing that work.`;
    }
    case "tracker_create_card": {
      if (!tracker.createCard) {
        return "This tracker does not support creating cards";
      }
      const listName = input.list_name as string;
      const title = input.title as string;
      const description = input.description as string | undefined;
      const created = await tracker.createCard({ listName, title, description });
      return `Created card "${title}" (${created.identifier}) in ${listName}: ${created.url}`;
    }
    case "tracker_create_list": {
      if (!tracker.createList) {
        return "This tracker does not support creating lists";
      }
      const name = input.name as string;
      const list = await tracker.createList(name);
      return `Created list "${list.name}" (id: ${list.id})`;
    }
    case "notion_write_page": {
      const title = input.title as string;
      const markdown = input.markdown as string;
      if (!title) return "Error: title is required";
      if (!markdown) return "Error: markdown content is required";
      if (!(tracker instanceof NotionAdapter)) {
        return "Error: notion_write_page requires a Notion tracker. Current tracker is " + tracker.kind;
      }
      const parentPageId = input.parent_page_id as string | undefined;
      const result = await tracker.writePage({ title, markdown, parentPageId });
      return `Created Notion page "${title}": ${result.url}`;
    }
    case "notion_search": {
      const query = input.query as string;
      if (!query) return "Error: query is required";
      if (!(tracker instanceof NotionAdapter)) {
        return "Error: notion_search requires a Notion tracker. Current tracker is " + tracker.kind;
      }
      const limit = Math.min(100, Math.max(1, (input.limit as number) ?? 10));
      const pages = await tracker.searchPages(query, limit);
      if (pages.length === 0) return `No Notion pages found for "${query}"`;
      return pages.map((p) => `- ${p.title} (${p.url})`).join("\n");
    }
    case "web_search": {
      const query = input.query as string;
      if (!query || typeof query !== "string") return "Error: query is required";
      const fcKey = process.env.FIRECRAWL_API_KEY;
      const bbKey = process.env.BROWSERBASE_API_KEY;
      const tavKey = process.env.TAVILY_API_KEY;
      if (fcKey) {
        const r = await firecrawlSearch(fcKey, query, 5, true);
        if (!r.startsWith("Error:")) return r;
      }
      if (bbKey) {
        const r = await browserbaseSearch(bbKey, query, 5);
        if (!r.startsWith("Error:")) return r;
      }
      if (tavKey) {
        const r = await tavilySearch(tavKey, query);
        if (!r.startsWith("Error:")) return r;
      }
      return `Web search for "${query}" - (Set FIRECRAWL_API_KEY, BROWSERBASE_API_KEY, or TAVILY_API_KEY to enable)`;
    }
    case "firecrawl_search": {
      const query = input.query as string;
      if (!query || typeof query !== "string") return "Error: query is required";
      const key = process.env.FIRECRAWL_API_KEY;
      if (!key) return "Error: FIRECRAWL_API_KEY is required";
      const limit = Math.min(100, Math.max(1, (input.limit as number) ?? 5));
      const scrape = input.scrape !== false;
      return firecrawlSearch(key, query, limit, scrape);
    }
    case "firecrawl_scrape": {
      const url = input.url as string;
      if (!url || typeof url !== "string") return "Error: url is required";
      const key = process.env.FIRECRAWL_API_KEY;
      if (!key) return "Error: FIRECRAWL_API_KEY is required";
      const onlyMain = input.only_main_content !== false;
      return firecrawlScrape(key, url, onlyMain);
    }
    case "browser_cdp": {
      const cmd = input.command as string;
      if (!cmd || typeof cmd !== "string") return "Error: command is required";
      return browserCdp(cmd);
    }
    case "browserbase_fetch": {
      const url = input.url as string;
      if (!url || typeof url !== "string") return "Error: url is required";
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY is required. Get one at https://www.browserbase.com/settings";
      const allowRedirects = input.allow_redirects === true;
      const proxies = input.proxies === true;
      return browserbaseFetch(key, url, allowRedirects, proxies);
    }
    case "browserbase_search": {
      const query = input.query as string;
      if (!query || typeof query !== "string") return "Error: query is required";
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY is required. Get one at https://www.browserbase.com/settings";
      const numResults = Math.min(25, Math.max(1, (input.num_results as number) ?? 10));
      return browserbaseSearch(key, query, numResults);
    }
    case "browserbase_session": {
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY is required";
      const projectId = process.env.BROWSERBASE_PROJECT_ID;
      if (!projectId) return "Error: BROWSERBASE_PROJECT_ID is required";
      const url = input.url as string | undefined;
      const result = await browserbaseCreateSession(key, projectId, url);
      if (typeof result === "string") return result;
      onMeta?.({ browserSessionId: result.sessionId, browserLiveUrl: result.liveUrl });
      return JSON.stringify({
        sessionId: result.sessionId,
        connectUrl: result.connectUrl,
        liveUrl: result.liveUrl,
        note: "Use browserbase_session_act with this sessionId to control (snapshot, click, fill, navigate). Call browserbase_session_close when done.",
      });
    }
    case "browserbase_session_act": {
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY is required";
      const sessionId = input.session_id as string | undefined;
      const action = input.action as string | undefined;
      if (!sessionId || typeof sessionId !== "string") {
        return "Error: session_id required (from browserbase_session result)";
      }
      if (!action || typeof action !== "string") {
        return "Error: action required (e.g. snapshot, click @e1, fill @e5 \"value\")";
      }
      return browserbaseSessionAct(key, sessionId, action);
    }
    case "browserbase_session_close": {
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY is required";
      const sessionId = input.session_id as string | undefined;
      if (!sessionId || typeof sessionId !== "string") {
        return "Error: session_id required (from browserbase_session result)";
      }
      return browserbaseReleaseSession(key, sessionId);
    }
    case "browserbase_browse": {
      const key = process.env.BROWSERBASE_API_KEY;
      const projectId = process.env.BROWSERBASE_PROJECT_ID;
      if (!key || !projectId) return "Error: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required";
      const action = input.action as string | undefined;
      if (!action || typeof action !== "string") return "Error: action required (open <url>, snapshot, click @ref, stop)";
      return browserbaseBrowse(key, projectId, action);
    }
    case "browserbase_stagehand_act": {
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY required";
      const modelKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!modelKey) return "Error: GEMINI_API_KEY or OPENAI_API_KEY required for Stagehand";
      const sessionId = input.session_id as string | undefined;
      const instruction = input.instruction as string | undefined;
      if (!sessionId || !instruction) return "Error: session_id and instruction required";
      return browserbaseStagehandAct(key, sessionId, instruction, modelKey);
    }
    case "browserbase_stagehand_extract": {
      const key = process.env.BROWSERBASE_API_KEY;
      if (!key) return "Error: BROWSERBASE_API_KEY required";
      const modelKey = process.env.GEMINI_API_KEY ?? process.env.OPENAI_API_KEY;
      if (!modelKey) return "Error: GEMINI_API_KEY or OPENAI_API_KEY required for Stagehand";
      const sessionId = input.session_id as string | undefined;
      const instruction = input.instruction as string | undefined;
      const schemaStr = input.schema as string | undefined;
      if (!sessionId || !instruction || !schemaStr) return "Error: session_id, instruction, schema required";
      return browserbaseStagehandExtract(key, sessionId, instruction, schemaStr, modelKey);
    }
    case "mcp_browserbase_call": {
      if (!process.env.ENABLE_BROWSERBASE_MCP) return "Error: ENABLE_BROWSERBASE_MCP not set. Set to 1 to enable.";
      const toolName = input.tool_name as string | undefined;
      const argsStr = input.args as string | undefined;
      if (!toolName || !argsStr) return "Error: tool_name and args required";
      return mcpBrowserbaseCall(toolName, argsStr);
    }

    // --- Cloudflare Dynamic Workers ---

    case "cloudflare_execute": {
      const creds = cfCreds();
      if (!creds) return "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required";
      const code = input.code as string;
      const taskId = (input.task_id as string) ?? `task-${Date.now()}`;
      if (!code) return "Error: code required";

      const executorUrl = process.env.CF_EXECUTOR_URL ?? "https://tgi-executor.nico-zahniser.workers.dev";
      const executorSecret = process.env.CF_EXECUTOR_SECRET ?? "tgi-exec-2026";

      try {
        // Call the executor Worker
        const res = await fetch(executorUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${executorSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code, task_id: taskId }),
        });
        const data = await res.json() as Record<string, unknown>;

        // If executor's internal call failed due to propagation, try calling sandbox directly
        if (!data.ok && data.worker_url) {
          const sandboxUrl = data.worker_url as string;
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const directRes = await fetch(sandboxUrl);
              if (directRes.ok) {
                const text = await directRes.text();
                let output: unknown;
                try { output = JSON.parse(text); } catch { output = text; }
                return JSON.stringify({ ok: true, output, elapsed_ms: data.elapsed_ms, task_id: taskId, source: "direct_retry" });
              }
            } catch {
              // retry
            }
          }
        }

        return JSON.stringify(data);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    case "cloudflare_deploy_worker": {
      const creds = cfCreds();
      if (!creds) return "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required in env";
      const workerName = input.name as string;
      const script = input.script as string;
      const cron = input.cron as string | undefined;
      if (!workerName || !script) return "Error: name and script required";

      // 1. Multipart form body (metadata + worker.js)
      const boundary = `----CFBoundary${Date.now()}`;
      const metadata = JSON.stringify({
        main_module: "worker.js",
        compatibility_date: "2024-09-23",
        compatibility_flags: ["nodejs_compat"],
      });
      const body = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="metadata"`,
        `Content-Type: application/json`,
        ``,
        metadata,
        `--${boundary}`,
        `Content-Disposition: form-data; name="worker.js"; filename="worker.js"`,
        `Content-Type: application/javascript+module`,
        ``,
        script,
        `--${boundary}--`,
      ].join("\r\n");

      // 2. Deploy worker
      const deployRes = await fetch(
        `${CF_API}/accounts/${creds.accountId}/workers/scripts/${workerName}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${creds.token}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body,
        }
      );
      if (!deployRes.ok) {
        const errText = await deployRes.text();
        return `Error deploying worker: ${deployRes.status} ${errText}`;
      }

      // 3. Enable workers.dev subdomain
      try {
        await fetch(
          `${CF_API}/accounts/${creds.accountId}/workers/scripts/${workerName}/subdomain`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${creds.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ enabled: true }),
          }
        );
      } catch {
        // non-fatal if subdomain enable fails
      }

      // 4. Set cron trigger if provided
      if (cron) {
        const cronRes = await fetch(
          `${CF_API}/accounts/${creds.accountId}/workers/scripts/${workerName}/schedules`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${creds.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([{ cron }]),
          }
        );
        if (!cronRes.ok) {
          const errText = await cronRes.text();
          return `Worker deployed but cron failed: ${cronRes.status} ${errText}`;
        }
      }

      // 5. Get workers.dev subdomain for URL
      let subdomain = "unknown";
      try {
        const subRes = await fetch(
          `${CF_API}/accounts/${creds.accountId}/workers/subdomain`,
          { headers: { Authorization: `Bearer ${creds.token}` } }
        );
        const subData = (await subRes.json()) as { result?: { subdomain?: string } };
        subdomain = subData?.result?.subdomain ?? "unknown";
      } catch {
        // non-fatal
      }

      const url = `https://${workerName}.${subdomain}.workers.dev`;
      return JSON.stringify({ ok: true, name: workerName, url, cron: cron ?? null });
    }

    case "cloudflare_delete_worker": {
      const creds = cfCreds();
      if (!creds) return "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required in env";
      const workerName = input.name as string;
      if (!workerName) return "Error: name required";
      const res = await fetch(
        `${CF_API}/accounts/${creds.accountId}/workers/scripts/${workerName}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${creds.token}` } }
      );
      if (!res.ok) {
        const errText = await res.text();
        return `Error deleting worker: ${res.status} ${errText}`;
      }
      return `Deleted worker "${workerName}"`;
    }

    case "cloudflare_list_workers": {
      const creds = cfCreds();
      if (!creds) return "Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required in env";
      const res = await fetch(
        `${CF_API}/accounts/${creds.accountId}/workers/scripts`,
        { headers: { Authorization: `Bearer ${creds.token}` } }
      );
      if (!res.ok) {
        const errText = await res.text();
        return `Error listing workers: ${res.status} ${errText}`;
      }
      const data = (await res.json()) as { result?: Array<{ id: string; modified_on: string }> };
      const scripts = data?.result ?? [];
      return JSON.stringify(scripts.map((s) => ({ name: s.id, modified: s.modified_on })));
    }

    case "tracker_board_snapshot": {
      // Fetch the full board JSON from Trello and return a condensed summary
      const key = process.env.TRELLO_API_KEY;
      const token = process.env.TRELLO_API_TOKEN;
      if (!key || !token) return "Error: TRELLO_API_KEY and TRELLO_API_TOKEN required";

      // Get board ID from the tracker config
      const boardId = (ctx.issue.metadata as any)?.raw?.idBoard;
      if (!boardId) return "Error: Could not determine board ID from issue metadata";

      try {
        const res = await fetch(
          `https://api.trello.com/1/boards/${boardId}?key=${key}&token=${token}&fields=name&lists=open&list_fields=name&cards=open&card_fields=name,desc,idList,labels,due,shortLink&card_attachments=false&labels=all&label_fields=name,color`
        );
        if (!res.ok) return `Error fetching board: ${res.status}`;
        const board = await res.json() as any;

        // Build condensed summary
        const lists = (board.lists ?? []) as Array<{ id: string; name: string }>;
        const cards = (board.cards ?? []) as Array<{ id: string; name: string; desc: string; idList: string; labels: Array<{ name: string }>; shortLink: string }>;
        const listMap = new Map(lists.map((l: any) => [l.id, l.name]));

        const summary: Record<string, Array<{ title: string; labels: string[]; shortLink: string; desc: string }>> = {};
        for (const list of lists) {
          summary[list.name] = [];
        }
        for (const card of cards) {
          const listName = listMap.get(card.idList) ?? "Unknown";
          if (!summary[listName]) summary[listName] = [];
          summary[listName].push({
            title: card.name,
            labels: (card.labels ?? []).map((l: any) => l.name),
            shortLink: card.shortLink,
            desc: card.desc?.slice(0, 200) ?? "",
          });
        }

        return JSON.stringify({
          board: board.name,
          lists: lists.map((l: any) => l.name),
          cards_by_list: summary,
          total_cards: cards.length,
        }, null, 2);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const {
    workspacePath,
    issue,
    tracker,
    registry,
    config,
    templateBody,
    maxTurns,
    attempt,
    onLog,
    signal,
  } = options;

  const provider = createProvider(config);
  const logs: string[] = [];

  const log = (msg: string): void => {
    logs.push(msg);
    onLog?.(msg);
    logger.info(msg, { sessionId: issue.id });
  };

  const hasResearchLabel = issue.labels.some((l) => l.toLowerCase() === "research");
  const experimentMode = config.agent.experiment_mode;

  if (hasResearchLabel && experimentMode?.enabled) {
    return runAgentWithExperimentMode(options);
  }

  return runAgentNormal(options);
}

async function runAgentNormal(options: RunOptions): Promise<RunResult> {
  const {
    workspacePath,
    issue,
    tracker,
    registry,
    config,
    templateBody,
    maxTurns,
    attempt,
    onLog,
    onMeta,
    signal,
  } = options;

  const provider = createProvider(config);
  const logs: string[] = [];
  const log = (msg: string): void => {
    logs.push(msg);
    onLog?.(msg);
    logger.info(msg, { sessionId: issue.id });
  };

  const prompt = buildPrompt(templateBody, config, issue, attempt);
  const messages: AgentMessage[] = [{ role: "user", content: prompt }];
  let turnCount = 0;
  const ctx = { workspacePath, issue, tracker, onMeta };

  const loopResult = await runAgentLoop({
    provider,
    messages,
    ctx,
    config,
    maxTurns,
    log,
    signal,
  });
  turnCount = loopResult.turnCount;
  Object.assign(messages, loopResult.messages);

  if (loopResult.status === "stopped") {
    return { status: "stopped", turnCount, logs, tokenUsage: loopResult.tokenUsage };
  }
  if (loopResult.status === "completed") {
    return { status: "completed", turnCount, logs, tokenUsage: loopResult.tokenUsage };
  }

  // max_turns reached
  log("Max turns reached");
  const trackerConfig = config.trackers.find((t) => t.id === issue.trackerId) as
    | { lists?: { unfinished?: string } }
    | undefined;
  const unfinishedList = trackerConfig?.lists?.unfinished;

  if (unfinishedList) {
    try {
      await tracker.transitionTo(issue.id, "unfinished");
      log(`Moved card to ${unfinishedList} for re-pick`);
    } catch (err) {
      logger.warn("Failed to move card to Unfinished", {
        issueId: issue.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const msg = unfinishedList
      ? `🔄 **Agent stopped: max turns reached** (${turnCount}/${maxTurns}). Task may be incomplete. Card moved to **${unfinishedList}** — agent will re-pick and continue from the workspace.`
      : `🔄 **Agent stopped: max turns reached** (${turnCount}/${maxTurns}). Task may be incomplete. Workspace preserved for inspection.`;
    await tracker.postComment(issue.id, msg);
  } catch (err) {
    logger.warn("Failed to post max-turns comment to tracker", {
      issueId: issue.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { status: "completed", turnCount, logs, tokenUsage: loopResult.tokenUsage };
}

interface LoopOptions {
  provider: IAgentProvider;
  messages: AgentMessage[];
  ctx: { workspacePath: string; issue: Issue; tracker: ITracker; onMeta?: MetaCallback };
  config: WorkflowConfig;
  maxTurns: number;
  log: (msg: string) => void;
  signal?: AbortSignal;
  experimentContext?: ExperimentContext;
}

interface LoopResult {
  status: "stopped" | "completed" | "max_turns";
  turnCount: number;
  messages: AgentMessage[];
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; cost?: number };
}

async function runAgentLoop(opts: LoopOptions): Promise<LoopResult> {
  const { provider, ctx, config, maxTurns, log, signal, experimentContext } = opts;
  let messages = [...opts.messages];
  let turnCount = 0;
  let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: undefined as number | undefined };

  while (turnCount < maxTurns) {
    if (signal?.aborted) {
      log("Agent stopped by signal");
      return { status: "stopped", turnCount, messages };
    }

    turnCount++;
    log(`Turn ${turnCount}`);

    const MAX_TOKENS = 200_000; // OpenRouter limit 262K; leave headroom
    const toSend = truncateToTokenLimit(messages, MAX_TOKENS);

    let response;
    try {
      response = await provider.complete(
        toSend,
        TOOL_DEFINITIONS,
        { model: config.agent.model, maxTokens: 4096, signal }
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        log("Agent stopped by signal");
        return { status: "stopped", turnCount, messages, tokenUsage };
      }
      throw err;
    }

    if (response.usage) {
      tokenUsage.promptTokens += response.usage.promptTokens;
      tokenUsage.completionTokens += response.usage.completionTokens;
      tokenUsage.totalTokens += response.usage.totalTokens;
      if (response.usage.cost != null) {
        tokenUsage.cost = (tokenUsage.cost ?? 0) + response.usage.cost;
      }
    }

    if (response.content) {
      messages.push({ role: "assistant", content: response.content });
      log(`Agent: ${response.content.slice(0, 200)}...`);
    }

    if (response.stopReason === "end_turn" || response.stopReason === "max_tokens") {
      log("Agent finished");
      return { status: "completed", turnCount, messages, tokenUsage };
    }

    if (response.stopReason === "tool_use" && response.toolUses?.length) {
      const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
      for (const use of response.toolUses) {
        try {
          const toolName = String(use.name || "").trim();
          const result = await executeTool(toolName, use.input, ctx);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: result });
          log(`Tool ${use.name}: ${result.length > 50000 ? result.slice(0, 50000) + "\n...[truncated]" : result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: `Error: ${msg}` });
          log(`Tool ${use.name} error: ${msg}`);
        }
      }
      const assistantContent: AgentMessage["content"] = response.content
        ? [{ type: "text", text: response.content }]
        : [];
      const assistantBlocks = [
        ...assistantContent,
        ...response.toolUses!.map((u) => ({
          type: "tool_use" as const,
          id: u.id,
          name: u.name,
          input: u.input,
        })),
      ];
      messages.push({ role: "assistant", content: assistantBlocks });
      messages.push({
        role: "user",
        content: toolResults.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      });
    }
  }

  return { status: "max_turns", turnCount, messages, tokenUsage };
}

async function runAgentWithExperimentMode(options: RunOptions): Promise<RunResult> {
  const {
    workspacePath,
    issue,
    tracker,
    config,
    templateBody,
    maxTurns,
    attempt,
    onLog,
    onMeta,
    signal,
  } = options;

  const logs: string[] = [];
  const log = (msg: string): void => {
    logs.push(msg);
    onLog?.(msg);
    logger.info(msg, { sessionId: issue.id });
  };

  const experimentMode = config.agent.experiment_mode!;
  let totalTurns = 0;

  const experimentLog = await runExperimentLoop(
    workspacePath,
    issue,
    tracker,
    experimentMode,
    async (iteration, previousReverted) => {
      const experimentContext: ExperimentContext = { iteration, previousReverted };
      const prompt = buildPrompt(templateBody, config, issue, attempt, experimentContext);
      const messages: AgentMessage[] = [{ role: "user", content: prompt }];
      const provider = createProvider(config);
      const ctx = { workspacePath, issue, tracker, onMeta };

      const result = await runAgentLoop({
        provider,
        messages,
        ctx,
        config,
        maxTurns,
        log,
        signal,
        experimentContext,
      });

      totalTurns += result.turnCount;
    }
  );

  const anyKept = experimentLog.some((e) => e.kept);
  const last = experimentLog[experimentLog.length - 1];

  if (anyKept && last?.kept) {
    await tracker.postComment(
      issue.id,
      `🔬 Experiment complete. Best ${experimentMode.metric_key}=${last.result} after ${experimentLog.length} iterations.`
    );
    return {
      status: "completed",
      turnCount: totalTurns,
      logs,
      experimentLog,
      tokenUsage: undefined,
    };
  }

  // No iteration improved — move card to Unfinished for re-pick
  const trackerConfig = config.trackers.find((t) => t.id === issue.trackerId) as
    | { lists?: { unfinished?: string } }
    | undefined;
  const unfinishedList = trackerConfig?.lists?.unfinished;

  if (unfinishedList) {
    try {
      await tracker.transitionTo(issue.id, "unfinished");
      log(`Experiment: no improvement after ${experimentLog.length} iterations. Moved to ${unfinishedList}`);
    } catch (err) {
      logger.warn("Failed to move card to Unfinished after experiment", {
        issueId: issue.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await tracker.postComment(
    issue.id,
    `🔬 Experiment finished: no iteration improved ${experimentMode.metric_key} after ${experimentLog.length} iterations.${unfinishedList ? ` Card moved to **${unfinishedList}** for re-pick.` : ""}`
  );

  return {
    status: "stopped",
    turnCount: totalTurns,
    logs,
    experimentLog,
    tokenUsage: undefined,
  };
}

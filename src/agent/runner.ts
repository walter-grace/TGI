/**
 * Multi-turn agent loop with tool execution.
 * Pattern: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Issue } from "../config/types.js";
import type { ITracker } from "../tracker/interface.js";
import type { TrackerRegistry } from "../tracker/registry.js";
import type { WorkflowConfig } from "../config/types.js";
import { buildPrompt } from "./prompt-builder.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import type { IAgentProvider, AgentMessage } from "./providers/interface.js";
import { createProvider } from "./providers/registry.js";
import { runInDir } from "../utils/shell.js";
import { logger } from "../observability/logger.js";
import { runExperimentLoop } from "./experiment.js";

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

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    workspacePath: string;
    issue: Issue;
    tracker: ITracker;
  }
): Promise<string> {
  const { workspacePath, issue, tracker } = ctx;

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
    case "web_search": {
      const query = input.query as string;
      if (!query || typeof query !== "string") return "Error: query is required";
      const key = process.env.TAVILY_API_KEY;
      if (!key) {
        return `Web search for "${query}" - (Set TAVILY_API_KEY to enable. Get a key at https://tavily.com)`;
      }
      return tavilySearch(key, query);
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
  const ctx = { workspacePath, issue, tracker };

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
  ctx: { workspacePath: string; issue: Issue; tracker: ITracker };
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
          log(`Tool ${use.name}: ${result.slice(0, 100)}...`);
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
      const ctx = { workspacePath, issue, tracker };

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

  const last = experimentLog[experimentLog.length - 1];
  if (last?.kept) {
    await tracker.postComment(
      issue.id,
      `🔬 Experiment complete. Best ${experimentMode.metric_key}=${last.result} after ${experimentLog.length} iterations.`
    );
  }

  return {
    status: "completed",
    turnCount: totalTurns,
    logs,
    error: undefined,
    experimentLog,
    tokenUsage: undefined, // Experiment mode runs multiple loops; could aggregate if needed
  };
}

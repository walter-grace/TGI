/**
 * Main orchestration loop: poll ALL trackers -> dispatch -> lifecycle.
 * Pattern: https://github.com/openai/symphony/blob/main/SPEC.md
 */

import type { TrackerRegistry } from "../tracker/registry.js";
import type { WorkflowConfig, Issue, TrackerListConfig } from "../config/types.js";
import type { LoadedWorkflow } from "../config/loader.js";
import {
  createWorkspace,
  removeWorkspace,
} from "../workspace/manager.js";
import {
  createSession,
  updateSession,
  appendLog,
  enqueue,
  dequeue,
  getQueueSize,
  getSession,
  isIssueInProgress,
  getRunningSessionIds,
  setAbortController,
} from "./state.js";
import { runAgent } from "../agent/runner.js";
import { trackerWriter } from "../notifications/tracker-writer.js";
import { metrics } from "../observability/metrics.js";
import { logger } from "../observability/logger.js";

export interface OrchestratorOptions {
  registry: TrackerRegistry;
  workflow: LoadedWorkflow;
}

const AGENT_PORT_BASE = 3200; // Daemon uses 3199; agents use 3200, 3201, ...

let agentPortCounter = 0;

function buildWorkspaceVars(config: WorkflowConfig, issue: Issue, agentIndex: number): Record<string, string> {
  const tracker = config.trackers.find((t) => t.id === issue.trackerId);
  if (!tracker) return {};

  const maxConcurrent = config.agent.max_concurrent_agents;
  const port = AGENT_PORT_BASE + (agentIndex % maxConcurrent);

  const vars: Record<string, string> = {
    PORT: String(port), // Unique port per concurrent agent (3200-3204 for max 5)
  };

  if (tracker.kind === "trello") {
    const tc = tracker as { api_key_env?: string; api_token_env?: string; board_id?: string };
    if (tc.api_key_env) {
      const v = process.env[tc.api_key_env];
      if (v) vars.TRELLO_API_KEY = v;
    }
    if (tc.api_token_env) {
      const v = process.env[tc.api_token_env];
      if (v) vars.TRELLO_API_TOKEN = v;
    }
    if (tc.board_id) {
      vars.TRELLO_BOARD_ID = tc.board_id;
    }
  }

  return vars;
}

export function createOrchestrator(options: OrchestratorOptions): {
  start: () => void;
  stop: () => void;
  tick: () => Promise<void>;
} {
  const { registry, workflow } = options;
  const { config, templateBody } = workflow;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    try {
      const issues = await registry.fetchAllReady();
      for (const issue of issues) {
        if (!isIssueInProgress(issue)) {
          enqueue(issue);
        }
      }

      metrics.setQueueSize(getQueueSize());

      const maxConcurrent = config.agent.max_concurrent_agents;
      const running = getRunningSessionIds().length;

      if (running < maxConcurrent) {
        const next = dequeue();
        if (next) {
          const session = createSession(next);
          const tracker = registry.get(next.trackerId);
          if (!tracker) {
            logger.error("Tracker not found", { trackerId: next.trackerId });
            updateSession(session.id, { status: "failed", error: "Tracker not found" });
          } else {
          updateSession(session.id, { status: "running" });
          metrics.setActiveCount(getRunningSessionIds().length);

          try {
            await tracker.transitionTo(next.id, "in_progress");
            logger.info("Card moved to Doing", { issueId: next.id, identifier: next.identifier });
          } catch (err) {
            logger.warn("Failed to move card to Doing", { issueId: next.id, error: err });
          }

          (async () => {
            const controller = new AbortController();
            setAbortController(session.id, controller);

            try {
              const agentIndex = agentPortCounter++;
              const workspaceVars = buildWorkspaceVars(config, next, agentIndex);
              const workspacePath = await createWorkspace(config.workspace, next, workspaceVars);
              const attempt = next.status === "unfinished" ? 2 : 1;
              const result = await runAgent({
                workspacePath,
                issue: next,
                tracker,
                registry,
                config,
                templateBody,
                maxTurns: config.agent.max_turns,
                attempt,
                onLog: (line) => appendLog(session.id, line),
                signal: controller.signal,
              });

              updateSession(session.id, {
                status: result.status === "stopped" ? "stopped" : "completed",
                turnCount: result.turnCount,
                error: result.error,
                experimentLog: result.experimentLog,
                tokenUsage: result.tokenUsage,
              });

              await trackerWriter.onSessionComplete(
                session.id,
                registry,
                config
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error("Agent run failed", { sessionId: session.id, error: msg });
              updateSession(session.id, {
                status: "failed",
                error: msg,
              });
              await trackerWriter.onSessionComplete(
                session.id,
                registry,
                config
              );
            } finally {
              const s = getSession(session.id);
              const keepWorkspace = config.workspace.keep_workspace !== false;
              if (!keepWorkspace && (s?.status === "completed" || s?.status === "failed" || s?.status === "stopped")) {
                try {
                  await removeWorkspace(config.workspace, next);
                } catch {
                  // ignore cleanup errors
                }
              }
              metrics.setActiveCount(getRunningSessionIds().length);
            }
          })();
          }
        }
      }
    } catch (err) {
      logger.error("Orchestrator tick failed", { error: err });
    }
  };

  const recoverOrphanedCards = async (): Promise<void> => {
    for (const tc of config.trackers) {
      const lists = tc.lists as TrackerListConfig | undefined;
      if (!lists?.in_progress || !lists?.ready) continue;
      const tracker = registry.get(tc.id);
      if (!tracker?.fetchCardsInList) continue;
      try {
        const issues = await tracker.fetchCardsInList(lists.in_progress);
        for (const issue of issues) {
          if (!isIssueInProgress(issue)) {
            try {
              await tracker.transitionTo(issue.id, "ready");
              enqueue(issue);
              logger.info("Recovered orphaned card from Doing", {
                issueId: issue.id,
                identifier: issue.identifier,
              });
            } catch (err) {
              logger.warn("Failed to recover orphaned card", {
                issueId: issue.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        logger.warn("Orphan recovery failed for tracker", {
          trackerId: tc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const start = (): void => {
    const intervalMs = 30_000;
    intervalId = setInterval(tick, intervalMs);
    (async () => {
      await recoverOrphanedCards();
      await tick();
    })();
    logger.info("Orchestrator started", { intervalMs });
  };

  const stop = (): void => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    logger.info("Orchestrator stopped");
  };

  return { start, stop, tick };
}

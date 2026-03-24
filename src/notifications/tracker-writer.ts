/**
 * Generic state write-back to source tracker.
 * Never references Trello directly — uses ITracker interface.
 */

import type { TrackerRegistry } from "../tracker/registry.js";
import type { WorkflowConfig } from "../config/types.js";
import { getSession } from "../orchestrator/state.js";
import { logger } from "../observability/logger.js";
import { sendDiscordNotification } from "./discord.js";

export const trackerWriter = {
  async onSessionComplete(
    sessionId: string,
    registry: TrackerRegistry,
    _config: WorkflowConfig
  ): Promise<void> {
    const session = getSession(sessionId);
    if (!session) return;

    const tracker = registry.get(session.issue.trackerId);
    if (!tracker) return;

    try {
      if (session.status === "completed") {
        await tracker.transitionTo(session.issue.id, "done");
        await tracker.postComment(
          session.issue.id,
          `✅ Agent completed in ${session.turnCount ?? 0} turns.`
        );
      } else if (session.status === "failed") {
        await tracker.transitionTo(session.issue.id, "failed");
        await tracker.postComment(
          session.issue.id,
          `❌ Agent failed: ${session.error ?? "Unknown error"}`
        );
      } else if (session.status === "stopped") {
        await tracker.transitionTo(session.issue.id, "in_progress");
        await tracker.postComment(
          session.issue.id,
          `⏸ Agent stopped by user.`
        );
      }
    } catch (err) {
      logger.error("Tracker write-back failed", {
        sessionId,
        trackerId: session.issue.trackerId,
        error: err,
      });
    }

    const usage = session.tokenUsage
      ? ` (${session.tokenUsage.totalTokens} tokens${session.tokenUsage.cost != null ? `, $${session.tokenUsage.cost.toFixed(4)}` : ""})`
      : "";
    if (session.status === "completed") {
      await sendDiscordNotification(
        `✅ **${session.issue.identifier}** completed in ${session.turnCount ?? 0} turns${usage}`
      );
    } else if (session.status === "failed") {
      await sendDiscordNotification(
        `❌ **${session.issue.identifier}** failed: ${(session.error ?? "Unknown").slice(0, 200)}`
      );
    } else if (session.status === "stopped") {
      await sendDiscordNotification(`⏸ **${session.issue.identifier}** stopped by user`);
    }
  },
};

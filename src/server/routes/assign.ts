/**
 * POST /api/assign — assign an issue to queue.
 * Body: { trackerId, issueId, profile? }
 */

import { Router } from "express";
import { enqueue } from "../../orchestrator/state.js";
import type { TrackerRegistry } from "../../tracker/registry.js";

export function createAssignRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const { trackerId, issueId } = req.body as {
      trackerId?: string;
      issueId?: string;
      profile?: string;
    };

    if (!trackerId || !issueId) {
      res.status(400).json({ error: "trackerId and issueId required" });
      return;
    }

    const tracker = registry.get(trackerId);
    if (!tracker) {
      res.status(404).json({ error: "Tracker not found" });
      return;
    }

    try {
      const issues = await tracker.fetchReadyIssues();
      const issue =
        issues.find((i) => i.id === issueId) ??
        issues.find((c) => c.identifier === issueId);
      if (!issue) {
        res.status(404).json({ error: "Issue not found or not in ready state" });
        return;
      }
      enqueue(issue);
      res.json({
        ok: true,
        trackerKind: issue.trackerKind,
        trackerId: issue.trackerId,
        issueIdentifier: issue.identifier,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
export default createAssignRouter;

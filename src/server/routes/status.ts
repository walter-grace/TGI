/**
 * GET /api/status — daemon health, queue size, active count, connected trackers.
 */

import { Router } from "express";
import { metrics } from "../../observability/metrics.js";
import type { TrackerRegistry } from "../../tracker/registry.js";

export function createStatusRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const health = await registry.healthCheckAll();
    const connectedTrackers = Array.from(health.entries()).map(
      ([id, healthy]) => {
        const tracker = registry.get(id);
        return {
          id,
          kind: tracker?.kind ?? "unknown",
          healthy,
        };
      }
    );

    res.json({
      ok: true,
      queueSize: metrics.getQueueSize(),
      activeCount: metrics.getActiveCount(),
      connectedTrackers,
    });
  });

  return router;
}

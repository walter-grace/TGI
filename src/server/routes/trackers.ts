/**
 * GET /api/trackers — list connected trackers
 * POST /api/trackers — add tracker at runtime
 * DELETE /api/trackers/:id — remove tracker
 */

import { Router } from "express";
import type { TrackerRegistry } from "../../tracker/registry.js";
import type { TrackerConfig } from "../../config/types.js";

export function createTrackersRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const trackers = registry.getAll();
    const health = await registry.healthCheckAll();
    const items = trackers.map((t) => ({
      id: t.id,
      kind: t.kind,
      healthy: health.get(t.id) ?? false,
    }));
    res.json({ trackers: items });
  });

  router.post("/", async (req, res) => {
    const config = req.body as TrackerConfig;
    if (!config.kind || !config.id) {
      res.status(400).json({ error: "kind and id required" });
      return;
    }
    try {
      const adapter = registry.register(config);
      await adapter.initialize();
      res.json({
        ok: true,
        id: adapter.id,
        kind: adapter.kind,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.delete("/:id", (req, res) => {
    const removed = registry.unregister(req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Tracker not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
export default createTrackersRouter;

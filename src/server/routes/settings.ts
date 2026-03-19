/**
 * GET/PUT /api/settings — runtime settings (stub).
 */

import { Router } from "express";

export function createSettingsRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ settings: {} });
  });

  router.put("/", (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}

/**
 * TGI Express app — REST API.
 */

import express from "express";
import cors from "cors";
import { join } from "node:path";
import type { TrackerRegistry } from "../tracker/registry.js";
import { createStatusRouter } from "./routes/status.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createAssignRouter } from "./routes/assign.js";
import { createTrackersRouter } from "./routes/trackers.js";
import { createSettingsRouter } from "./routes/settings.js";

export function createApp(registry: TrackerRegistry): express.Application {
  const app = express();
  app.use(express.json());
  app.use(cors({ origin: "*" }));

  app.use("/api/status", createStatusRouter(registry));
  app.use("/api/sessions", createSessionsRouter(registry));
  app.use("/api/assign", createAssignRouter(registry));
  app.use("/api/trackers", createTrackersRouter(registry));
  app.use("/api/settings", createSettingsRouter());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const publicDir = join(process.cwd(), "public");
  app.use("/dashboard", express.static(publicDir));
  app.get("/dashboard", (_req, res) => {
    res.sendFile(join(publicDir, "dashboard.html"));
  });

  return app;
}

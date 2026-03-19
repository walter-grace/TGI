/**
 * TGI (TrelloGI) daemon entrypoint.
 * Loads WORKFLOW.md, initializes trackers, starts REST API and orchestrator.
 */

import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import { createServer } from "node:http";
import { TrackerRegistry } from "./tracker/registry.js";
import { loadWorkflow } from "./config/loader.js";
import { createApp } from "./server/app.js";
import { createOrchestrator } from "./orchestrator/orchestrator.js";
import { logger } from "./observability/logger.js";
import { loadSessionsFromDisk, saveSessionsToDisk } from "./persistence/sessions.js";
import { loadSessions, setOnUpdate } from "./orchestrator/state.js";

const port = parseInt(process.env.TGI_PORT ?? process.env.SYMPHONY_PORT ?? "3199", 10);

async function main(): Promise<void> {
  const loaded = loadSessionsFromDisk();
  loadSessions(loaded);
  if (loaded.length > 0) {
    logger.info("Loaded persisted sessions", { count: loaded.length });
  }
  setOnUpdate(() => saveSessionsToDisk());

  const workflow = loadWorkflow();
  const registry = new TrackerRegistry();

  for (const config of workflow.config.trackers) {
    try {
      const adapter = registry.register(config);
      await adapter.initialize();
      logger.info("Tracker registered", { id: adapter.id, kind: adapter.kind });
    } catch (err) {
      logger.error("Failed to register tracker", {
        id: config.id,
        kind: config.kind,
        error: err,
      });
    }
  }

  const app = createApp(registry);
  const server = createServer(app);

  const orchestrator = createOrchestrator({
    registry,
    workflow,
  });
  orchestrator.start();

  server.listen(port, () => {
    logger.info("TGI daemon started", { port });
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

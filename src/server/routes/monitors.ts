/**
 * POST /api/webhooks/monitor — receives results from Cloudflare Worker monitors.
 * On failure, creates a Trello card in "Ready For Agent" with the self-heal-fix label.
 */

import { Router } from "express";
import type { TrackerRegistry } from "../../tracker/registry.js";
import { logger } from "../../observability/logger.js";

export function createMonitorWebhookRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { monitor_name, repo_url, status, error, details, secret } = req.body ?? {};

      // Validate shared secret if configured
      const expectedSecret = process.env.MONITOR_WEBHOOK_SECRET;
      if (expectedSecret && secret !== expectedSecret) {
        res.status(401).json({ error: "Invalid secret" });
        return;
      }

      if (!monitor_name || !status) {
        res.status(400).json({ error: "monitor_name and status required" });
        return;
      }

      logger.info("Monitor webhook received", { monitor_name, status });

      if (status === "pass") {
        res.json({ ok: true, action: "none" });
        return;
      }

      // Find a Trello tracker that supports createCard
      const trackers = registry.getAll();
      const tracker = trackers.find(
        (t) => t.kind === "trello" && typeof (t as any).createCard === "function"
      );

      if (!tracker || typeof (tracker as any).createCard !== "function") {
        logger.warn("Monitor webhook: no Trello tracker available to create fix card");
        res.status(500).json({ error: "No Trello tracker available" });
        return;
      }

      const title = `[Self-Heal Fix] ${monitor_name} failure`;
      const description = [
        `## Repository`,
        repo_url ?? "N/A",
        ``,
        `## Monitor`,
        monitor_name,
        ``,
        `## Failure Output`,
        "```",
        error ?? "No error details",
        "```",
        ``,
        `## Details`,
        details ?? "Reported by Cloudflare Worker monitor",
        ``,
        `## Labels`,
        `self-heal-fix`,
      ].join("\n");

      const created = await (tracker as any).createCard({
        listName: "Ready For Agent",
        title,
        description,
      });

      // Add self-heal-fix label
      try {
        await tracker.addLabel(created.id, "self-heal-fix");
      } catch {
        // non-fatal
      }

      logger.info("Monitor webhook: created fix card", {
        card: created.identifier,
        monitor: monitor_name,
      });

      res.json({ ok: true, action: "card_created", card: created.identifier });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Monitor webhook error", { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

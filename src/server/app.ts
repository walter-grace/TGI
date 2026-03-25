/**
 * TGI Express app — REST API and chat webhooks.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import cors from "cors";
import type { TrackerRegistry } from "../tracker/registry.js";
import { createStatusRouter } from "./routes/status.js";
import { createSessionsRouter } from "./routes/sessions.js";
import { createAssignRouter } from "./routes/assign.js";
import { createTasksRouter } from "./routes/tasks.js";
import { createTrackersRouter } from "./routes/trackers.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createMessagingRouter } from "./routes/messaging.js";
import { createMonitorWebhookRouter } from "./routes/monitors.js";
import { createChatBot } from "../chat/bot.js";
import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";

const hasClerk = !!(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);

export function createApp(registry: TrackerRegistry): express.Application {
  const app = express();
  app.use(cors({ origin: "*" }));

  if (hasClerk) {
    app.use(clerkMiddleware());
  }

  // Chat webhooks need raw body for Slack signature verification — mount before json()
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  if (slackSigningSecret) {
    const chatBot = createChatBot(registry);
    app.post(
      "/api/webhooks/slack",
      express.raw({ type: "*/*" }),
      async (req: express.Request, res: express.Response) => {
        try {
          const body = req.body as Buffer | undefined;
          if (body && body.length > 0) {
            const parsed = JSON.parse(body.toString()) as { type?: string; challenge?: string; event?: { type?: string; text?: string } };
            if (parsed.type === "url_verification" && parsed.challenge) {
              return res.status(200).json({ challenge: parsed.challenge });
            }
            console.log(`[Slack webhook] type=${parsed.type ?? "?"} event=${parsed.event?.type ?? "?"} text=${(parsed.event?.text ?? "").slice(0, 80)}`);
          }
          const url = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
          }
          const request = new Request(url, {
            method: req.method,
            headers,
            body: body && body.length > 0 ? body : undefined,
          });
          const response = await chatBot.webhooks.slack(request);
          res.status(response.status);
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.send(await response.text());
        } catch (err) {
          console.error("Chat webhook error:", err);
          res.status(500).send("Internal error");
        }
      }
    );
  }

  app.use(express.json());

  const publicDir = join(process.cwd(), "public");

  // Public routes (no auth)
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      clerkEnabled: hasClerk,
      clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? "",
    });
  });

  app.get("/sign-in", (_req, res) => {
    const htmlPath = join(publicDir, "sign-in.html");
    let html = readFileSync(htmlPath, "utf-8");
    const pk = process.env.CLERK_PUBLISHABLE_KEY ?? "";
    html = html.replace('data-clerk-pk=""', `data-clerk-pk="${pk.replace(/"/g, "&quot;")}"`);
    res.type("html").send(html);
  });

  app.get("/sign-out", (_req, res) => {
    const htmlPath = join(publicDir, "sign-out.html");
    let html = readFileSync(htmlPath, "utf-8");
    const pk = process.env.CLERK_PUBLISHABLE_KEY ?? "";
    html = html.replace('data-clerk-pk=""', `data-clerk-pk="${pk.replace(/"/g, "&quot;")}"`);
    res.type("html").send(html);
  });

  // Monitor webhook (public — uses shared secret, called by Cloudflare Workers)
  app.use("/api/webhooks/monitor", createMonitorWebhookRouter(registry));

  // Protected routes (require auth when Clerk is configured, unless TGI_DISABLE_AUTH for testing)
  const disableAuth = process.env.TGI_DISABLE_AUTH === "true" || process.env.TGI_DISABLE_AUTH === "1";
  const protect = hasClerk && !disableAuth ? requireAuth() : (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();

  app.use("/api/status", protect, createStatusRouter(registry));
  app.use("/api/sessions", protect, createSessionsRouter(registry));
  app.use("/api/assign", protect, createAssignRouter(registry));
  app.use("/api/tasks", protect, createTasksRouter(registry));
  app.use("/api/trackers", protect, createTrackersRouter(registry));
  app.use("/api/settings", protect, createSettingsRouter());
  app.use("/api/messaging", protect, createMessagingRouter());

  app.get("/dashboard", protect, (_req, res) => {
    res.sendFile(join(publicDir, "dashboard.html"));
  });
  app.get("/dashboard/", protect, (_req, res) => {
    res.redirect(301, "/dashboard");
  });
  app.use("/dashboard", protect, express.static(publicDir));

  // Root: landing page when not signed in, redirect to dashboard when signed in
  app.get("/", (req, res) => {
    if (!hasClerk) {
      return res.redirect("/dashboard");
    }
    const { userId } = getAuth(req);
    if (userId) {
      return res.redirect("/dashboard");
    }
    res.sendFile(join(publicDir, "index.html"));
  });

  return app;
}

/**
 * GET/POST /api/sessions, GET /api/sessions/:id, GET /api/sessions/:id/logs (SSE),
 * POST /api/sessions/:id/stop, POST /api/sessions/:id/retry
 */

import { Router, Request, Response } from "express";
import {
  getAllSessions,
  getSession,
  updateSession,
  getQueue,
  enqueue,
  abortSession,
} from "../../orchestrator/state.js";
import type { TrackerRegistry } from "../../tracker/registry.js";

export function createSessionsRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const sessions = getAllSessions();
    const queue = getQueue();
    const items = sessions.map((s) => ({
      id: s.id,
      trackerKind: s.issue.trackerKind,
      trackerId: s.issue.trackerId,
      issueIdentifier: s.issue.identifier,
      status: s.status,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt,
      turnCount: s.turnCount,
      error: s.error,
      tokenUsage: s.tokenUsage,
    }));
    res.json({ sessions: items, queue: queue.map((q) => q.identifier) });
  });

  router.get("/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      id: session.id,
      trackerKind: session.issue.trackerKind,
      trackerId: session.issue.trackerId,
      issue: session.issue,
      status: session.status,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      logs: session.logs,
      turnCount: session.turnCount,
      experimentLog: session.experimentLog,
      error: session.error,
      tokenUsage: session.tokenUsage,
    });
  });

  router.get("/:id/logs", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let lastLen = 0;
    for (const line of session.logs) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
      lastLen++;
    }

    const interval = setInterval(() => {
      const updated = getSession(req.params.id);
      if (!updated) {
        clearInterval(interval);
        res.end();
        return;
      }
      const len = updated.logs.length;
      if (len > lastLen) {
        for (let i = lastLen; i < len; i++) {
          res.write(`data: ${JSON.stringify({ line: updated.logs[i] })}\n\n`);
        }
        lastLen = len;
      }
      if (
        updated.status === "completed" ||
        updated.status === "failed" ||
        updated.status === "stopped"
      ) {
        clearInterval(interval);
        res.end();
      }
    }, 1000);
  });

  router.post("/:id/stop", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "running" && session.status !== "queued") {
      res.status(400).json({ error: "Session not running" });
      return;
    }
    abortSession(req.params.id);
    updateSession(req.params.id, { status: "stopped" });
    res.json({ ok: true, status: "stopped" });
  });

  router.post("/:id/retry", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.status !== "failed") {
      res.status(400).json({ error: "Can only retry failed sessions" });
      return;
    }
    enqueue(session.issue);
    res.json({ ok: true });
  });

  return router;
}

/**
 * Persist sessions to disk so history survives daemon restart.
 * Uses JSON file; no external DB required.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentSession } from "../config/types.js";
import { getAllSessions } from "../orchestrator/state.js";
import { logger } from "../observability/logger.js";

const DEFAULT_PATH = "data/sessions.json";

function getSessionsPath(): string {
  return process.env.TGI_SESSIONS_FILE ?? process.env.SYMPHONY_SESSIONS_FILE ?? DEFAULT_PATH;
}

export function loadSessionsFromDisk(): AgentSession[] {
  const path = getSessionsPath();
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as AgentSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    logger.warn("Could not load sessions from disk", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export function saveSessionsToDisk(): void {
  const path = getSessionsPath();
  try {
    const sessions = getAllSessions();
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(sessions, null, 0), "utf-8");
  } catch (err) {
    logger.warn("Could not save sessions to disk", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * In-memory session state store.
 * Tracks active/queued/completed sessions with tracker context.
 */

import type { AgentSession, Issue, SessionStatus } from "../config/types.js";

const sessions = new Map<string, AgentSession>();
const queue: Issue[] = [];
const abortControllers = new Map<string, AbortController>();

let onUpdate: (() => void) | null = null;

export function setOnUpdate(callback: (() => void) | null): void {
  onUpdate = callback;
}

function maybePersist(): void {
  onUpdate?.();
}

export function loadSessions(loaded: AgentSession[]): void {
  sessions.clear();
  for (const s of loaded) {
    sessions.set(s.id, s);
  }
}

export function createSession(issue: Issue): AgentSession {
  const id = `${issue.trackerKind}-${issue.id}-${Date.now()}`;
  const session: AgentSession = {
    id,
    issue,
    status: "queued",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
  };
  sessions.set(id, session);
  maybePersist();
  return session;
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

export function getAllSessions(): AgentSession[] {
  return Array.from(sessions.values());
}

export function updateSession(
  id: string,
  updates: Partial<Pick<AgentSession, "status" | "logs" | "error" | "turnCount" | "experimentLog" | "tokenUsage" | "updatedAt">>
): void {
  const s = sessions.get(id);
  if (s) {
    Object.assign(s, updates);
    if (updates.updatedAt === undefined) {
      s.updatedAt = new Date().toISOString();
    }
    maybePersist();
  }
}

export function appendLog(id: string, line: string): void {
  const s = sessions.get(id);
  if (s) {
    s.logs.push(line);
    s.updatedAt = new Date().toISOString();
    // Skip persist on every log line; persist on create/update only
  }
}

export function enqueue(issue: Issue): void {
  const key = `${issue.trackerKind}-${issue.id}`;
  const alreadyQueued = queue.some(
    (q) => `${q.trackerKind}-${q.id}` === key
  );
  if (!alreadyQueued) queue.push(issue);
}

export function dequeue(): Issue | undefined {
  return queue.shift();
}

export function getQueue(): Issue[] {
  return [...queue];
}

export function getQueueSize(): number {
  return queue.length;
}

export function getActiveCount(): number {
  return Array.from(sessions.values()).filter(
    (s) => s.status === "running" || s.status === "queued"
  ).length;
}

export function getRunningSessionIds(): string[] {
  return Array.from(sessions.entries())
    .filter(([, s]) => s.status === "running")
    .map(([id]) => id);
}

export function setAbortController(sessionId: string, controller: AbortController): void {
  abortControllers.set(sessionId, controller);
}

export function abortSession(sessionId: string): boolean {
  const controller = abortControllers.get(sessionId);
  if (controller) {
    controller.abort();
    abortControllers.delete(sessionId);
    return true;
  }
  return false;
}

export function isIssueInProgress(issue: Issue): boolean {
  const key = `${issue.trackerKind}-${issue.id}`;
  return Array.from(sessions.values()).some(
    (s) =>
      (s.status === "running" || s.status === "queued") &&
      `${s.issue.trackerKind}-${s.issue.id}` === key
  );
}

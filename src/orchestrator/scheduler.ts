/**
 * Concurrency and retry logic for agent dispatch.
 */

import type { Issue } from "../config/types.js";
import { getRunningSessionIds } from "./state.js";

export function canAcceptNew(
  maxConcurrent: number,
  _queue: Issue[]
): boolean {
  const running = getRunningSessionIds().length;
  return running < maxConcurrent;
}

export function selectNextFromQueue(
  queue: Issue[],
  inProgress: Set<string>
): Issue | undefined {
  for (const issue of queue) {
    const key = `${issue.trackerKind}-${issue.id}`;
    if (!inProgress.has(key)) return issue;
  }
  return undefined;
}

/**
 * TrackerRegistry — manages multiple tracker connections.
 * Orchestrator polls ALL registered trackers each tick.
 */

import type { ITracker } from "./interface.js";
import type { Issue } from "./interface.js";
import { createTracker } from "./factory.js";
import type { TrackerConfig } from "../config/types.js";

export class TrackerRegistry {
  private trackers = new Map<string, ITracker>();

  register(config: TrackerConfig): ITracker {
    const adapter = createTracker(config);
    this.trackers.set(adapter.id, adapter);
    return adapter;
  }

  unregister(id: string): boolean {
    return this.trackers.delete(id);
  }

  get(id: string): ITracker | undefined {
    return this.trackers.get(id);
  }

  getAll(): ITracker[] {
    return Array.from(this.trackers.values());
  }

  async fetchAllReady(): Promise<Issue[]> {
    const results: Issue[] = [];
    for (const tracker of this.trackers.values()) {
      try {
        const issues = await tracker.fetchReadyIssues();
        results.push(...issues);
      } catch (err) {
        console.error(`Tracker ${tracker.id} fetchReadyIssues failed:`, err);
      }
    }
    return results;
  }

  async healthCheckAll(): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    for (const tracker of this.trackers.values()) {
      try {
        map.set(tracker.id, await tracker.healthCheck());
      } catch {
        map.set(tracker.id, false);
      }
    }
    return map;
  }
}

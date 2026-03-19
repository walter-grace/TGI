/**
 * Adapter factory — the ONLY place that imports concrete tracker adapters.
 * Everything else uses ITracker from interface.ts.
 */

import type { ITracker } from "./interface.js";
import type { TrackerConfig, TrelloTrackerConfig } from "../config/types.js";
import { TrelloAdapter } from "./adapters/trello.js";
import { JiraAdapter } from "./adapters/jira.js";
import { LinearAdapter } from "./adapters/linear.js";
import { GitHubAdapter } from "./adapters/github.js";

export function createTracker(config: TrackerConfig): ITracker {
  switch (config.kind) {
    case "trello":
      return new TrelloAdapter(config as unknown as TrelloTrackerConfig);
    case "jira":
      return new JiraAdapter(config as Record<string, unknown>);
    case "linear":
      return new LinearAdapter(config as Record<string, unknown>);
    case "github":
      return new GitHubAdapter(config as Record<string, unknown>);
    default:
      throw new Error(`Unknown tracker kind: ${config.kind}`);
  }
}

/**
 * GitHubAdapter — stub for v2.
 * GitHub Issues API: https://docs.github.com/en/rest/issues
 */

import type { ITracker } from "../interface.js";
import type { Issue, IssueState } from "../models.js";

const GITHUB_DOCS = "https://docs.github.com/en/rest/issues";

export class GitHubAdapter implements ITracker {
  readonly kind = "github";
  readonly id: string;

  constructor(_config: Record<string, unknown>) {
    this.id = (_config.id as string) ?? "github-stub";
  }

  async initialize(): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async healthCheck(): Promise<boolean> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async fetchReadyIssues(): Promise<Issue[]> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async transitionTo(_issueId: string, _state: IssueState): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async postComment(_issueId: string, _text: string): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async updateChecklist(
    _issueId: string,
    _itemId: string,
    _checked: boolean
  ): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async addLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }

  async removeLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `GitHubAdapter not yet implemented. See: ${GITHUB_DOCS}`
    );
  }
}

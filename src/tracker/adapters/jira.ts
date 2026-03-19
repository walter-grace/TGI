/**
 * JiraAdapter — stub for v2.
 * Jira REST API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
 */

import type { ITracker } from "../interface.js";
import type { Issue, IssueState } from "../models.js";

const JIRA_DOCS =
  "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/";

export class JiraAdapter implements ITracker {
  readonly kind = "jira";
  readonly id: string;

  constructor(_config: Record<string, unknown>) {
    this.id = (_config.id as string) ?? "jira-stub";
  }

  async initialize(): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async healthCheck(): Promise<boolean> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async fetchReadyIssues(): Promise<Issue[]> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async transitionTo(_issueId: string, _state: IssueState): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async postComment(_issueId: string, _text: string): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async updateChecklist(
    _issueId: string,
    _itemId: string,
    _checked: boolean
  ): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async addLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }

  async removeLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `JiraAdapter not yet implemented. See: ${JIRA_DOCS}`
    );
  }
}

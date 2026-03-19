/**
 * LinearAdapter — stub for v2.
 * Linear GraphQL API: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

import type { ITracker } from "../interface.js";
import type { Issue, IssueState } from "../models.js";

const LINEAR_DOCS =
  "https://developers.linear.app/docs/graphql/working-with-the-graphql-api";

export class LinearAdapter implements ITracker {
  readonly kind = "linear";
  readonly id: string;

  constructor(_config: Record<string, unknown>) {
    this.id = (_config.id as string) ?? "linear-stub";
  }

  async initialize(): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async healthCheck(): Promise<boolean> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async fetchReadyIssues(): Promise<Issue[]> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async transitionTo(_issueId: string, _state: IssueState): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async postComment(_issueId: string, _text: string): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async updateChecklist(
    _issueId: string,
    _itemId: string,
    _checked: boolean
  ): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async addLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }

  async removeLabel(_issueId: string, _label: string): Promise<void> {
    throw new Error(
      `LinearAdapter not yet implemented. See: ${LINEAR_DOCS}`
    );
  }
}

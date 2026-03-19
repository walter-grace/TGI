/**
 * ITracker interface — THE scalability contract.
 * Adding a new tracker (Jira, Linear, GitHub, Asana) means implementing this interface.
 * Nothing else in the codebase changes.
 *
 * Design accommodates:
 *   Trello: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
 *   Jira: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
 *   Linear: https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 *   GitHub: https://docs.github.com/en/rest/issues
 */

import type { Issue, IssueState } from "../config/types.js";

export type { Issue, IssueState };

export interface ITracker {
  readonly kind: string;
  readonly id: string;

  initialize(): Promise<void>;
  healthCheck(): Promise<boolean>;

  fetchReadyIssues(): Promise<Issue[]>;

  transitionTo(issueId: string, state: IssueState): Promise<void>;

  postComment(issueId: string, text: string): Promise<void>;
  updateChecklist(issueId: string, itemId: string, checked: boolean): Promise<void>;

  addLabel(issueId: string, label: string): Promise<void>;
  removeLabel(issueId: string, label: string): Promise<void>;

  /** Create a new card in a list. Optional; not all trackers support this. */
  createCard?(params: {
    listName: string;
    title: string;
    description?: string;
  }): Promise<Issue>;

  /** Create a new list on the board. Optional; not all trackers support this. */
  createList?(name: string): Promise<{ id: string; name: string }>;

  /** Fetch cards from a specific list. Optional; used for orphan recovery (e.g. Doing). */
  fetchCardsInList?(listName: string): Promise<Issue[]>;
}

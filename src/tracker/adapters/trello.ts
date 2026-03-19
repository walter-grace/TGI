/**
 * TrelloAdapter — v1 implementation of ITracker.
 * Trello REST API: https://developer.atlassian.com/cloud/trello/rest/api-group-cards/
 * Base URL: https://api.trello.com/1/
 * Auth: key={apiKey}&token={apiToken} query params
 */

import type { ITracker } from "../interface.js";
import type { Issue, IssueState, ChecklistItem, Comment } from "../models.js";
import type { TrelloTrackerConfig, TrackerListConfig } from "../../config/types.js";
import { getEnvFromConfig } from "../../config/loader.js";
import { logger } from "../../observability/logger.js";

const BASE = "https://api.trello.com/1";

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idLabels: string[];
  due: string | null;
  shortLink: string;
  url: string;
  idMembers?: string[];
}

interface TrelloCheckItem {
  id: string;
  name: string;
  state: "complete" | "incomplete";
}

interface TrelloChecklist {
  id: string;
  checkItems: TrelloCheckItem[];
}

interface TrelloAction {
  id: string;
  type: string;
  data: { text?: string };
  memberCreator?: { fullName?: string };
  date: string;
}

interface TrelloLabel {
  id: string;
  name: string;
  color?: string;
}

function authParams(key: string, token: string): string {
  return `key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Trello: 100 req/10s per token. Throttle to 80/10s to leave headroom. */
const requestTimestamps: number[] = [];
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 80;

async function throttleTrello(): Promise<void> {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= MAX_PER_WINDOW) {
    const waitMs = requestTimestamps[0] + WINDOW_MS - now;
    await sleep(Math.max(100, waitMs));
    return throttleTrello();
  }
  requestTimestamps.push(now);
}

async function trelloFetch<T>(
  path: string,
  key: string,
  token: string,
  init?: RequestInit,
  retryCount = 0
): Promise<T> {
  const maxRetries = 3;
  await throttleTrello();

  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}${authParams(key, token)}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (res.status === 429 && retryCount < maxRetries) {
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10_000;
    const waitSec = Math.min(waitMs, 30_000) / 1000;
    logger.warn("Trello rate limit (429), retrying", {
      attempt: retryCount + 1,
      waitSeconds: waitSec,
    });
    await sleep(Math.min(waitMs, 30_000));
    return trelloFetch(path, key, token, init, retryCount + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export class TrelloAdapter implements ITracker {
  readonly kind = "trello";
  readonly id: string;

  private readonly boardId: string;
  private readonly key: string;
  private readonly token: string;
  private readonly lists: TrackerListConfig;
  private readonly labelFilters: string[];
  private listIdMap: Map<string, string> = new Map();

  constructor(config: TrelloTrackerConfig) {
    this.id = config.id;
    this.boardId = config.board_id;
    this.key = getEnvFromConfig(config.api_key_env);
    this.token = getEnvFromConfig(config.api_token_env);
    this.lists = config.lists;
    this.labelFilters = config.label_filters ?? [];
  }

  async initialize(): Promise<void> {
    await this.refreshListMap();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await trelloFetch(`/boards/${this.boardId}`, this.key, this.token);
      return true;
    } catch {
      return false;
    }
  }

  private async refreshListMap(): Promise<void> {
    const lists = await trelloFetch<TrelloList[]>(
      `/boards/${this.boardId}/lists`,
      this.key,
      this.token
    );
    const map = new Map<string, string>();
    for (const list of lists) {
      map.set(list.name, list.id);
    }
    this.listIdMap = map;
  }

  private getListId(name: string): string {
    const id = this.listIdMap.get(name);
    if (!id) {
      throw new Error(`Trello list "${name}" not found on board ${this.boardId}`);
    }
    return id;
  }

  async fetchReadyIssues(): Promise<Issue[]> {
    await this.refreshListMap();
    const listNames = [this.lists.ready];
    if (this.lists.unfinished) listNames.push(this.lists.unfinished);

    const issues: Issue[] = [];
    for (const listName of listNames) {
      const listId = this.getListId(listName);
      const cards = await trelloFetch<TrelloCard[]>(
        `/lists/${listId}/cards`,
        this.key,
        this.token
      );
    for (const card of cards) {
      if (this.labelFilters.length > 0) {
        const labels = await this.getCardLabels(card.id);
        const names = labels.map((l) => l.name);
        const hasFilter = this.labelFilters.some((f) => names.includes(f));
        if (!hasFilter) continue;
      }
      const issue = await this.normalizeCard(card);
      issues.push(issue);
    }
    }
    return issues;
  }

  /** Fetch cards from a specific list (e.g. Doing). Used for orphan recovery. */
  async fetchCardsInList(listName: string): Promise<Issue[]> {
    await this.refreshListMap();
    const listId = this.getListId(listName);
    const cards = await trelloFetch<TrelloCard[]>(
      `/lists/${listId}/cards`,
      this.key,
      this.token
    );
    const issues: Issue[] = [];
    for (const card of cards) {
      if (this.labelFilters.length > 0) {
        const labels = await this.getCardLabels(card.id);
        const names = labels.map((l) => l.name);
        const hasFilter = this.labelFilters.some((f) => names.includes(f));
        if (!hasFilter) continue;
      }
      const issue = await this.normalizeCard(card);
      issues.push(issue);
    }
    return issues;
  }

  private async getCardLabels(cardId: string): Promise<TrelloLabel[]> {
    const boardLabels = await trelloFetch<TrelloLabel[]>(
      `/boards/${this.boardId}/labels`,
      this.key,
      this.token
    );
    const card = await trelloFetch<TrelloCard>(
      `/cards/${cardId}?fields=idLabels`,
      this.key,
      this.token
    );
    const idSet = new Set(card.idLabels);
    return boardLabels.filter((l) => idSet.has(l.id));
  }

  private async normalizeCard(card: TrelloCard): Promise<Issue> {
    const checklists = await trelloFetch<TrelloChecklist[]>(
      `/cards/${card.id}/checklists`,
      this.key,
      this.token
    );
    const checklist: ChecklistItem[] = [];
    for (const cl of checklists) {
      for (const ci of cl.checkItems) {
        checklist.push({
          id: ci.id,
          name: ci.name,
          checked: ci.state === "complete",
        });
      }
    }

    const actions = await trelloFetch<TrelloAction[]>(
      `/cards/${card.id}/actions?filter=commentCard`,
      this.key,
      this.token
    );
    const comments: Comment[] = actions.map((a) => ({
      id: a.id,
      author: a.memberCreator?.fullName ?? "Unknown",
      text: a.data.text ?? "",
      createdAt: a.date,
    }));

    const labels = (await this.getCardLabels(card.id)).map((l) => l.name);

    const listName = this.getListNameById(card.idList);
    const status = this.listNameToStatus(listName);

    return {
      id: card.id,
      trackerId: this.id,
      trackerKind: this.kind,
      identifier: card.shortLink,
      title: card.name,
      description: card.desc ?? "",
      labels,
      checklist,
      comments,
      assignee: null,
      dueDate: card.due ?? null,
      status,
      url: card.url,
      metadata: { raw: card },
    };
  }

  private getListNameById(id: string): string {
    for (const [name, listId] of this.listIdMap) {
      if (listId === id) return name;
    }
    return "ready";
  }

  private listNameToStatus(name: string): IssueState {
    if (name === this.lists.ready) return "ready";
    if (name === this.lists.in_progress) return "in_progress";
    if (name === this.lists.review) return "review";
    if (name === this.lists.done) return "done";
    if (name === this.lists.failed) return "failed";
    if (this.lists.unfinished && name === this.lists.unfinished) return "unfinished";
    return "ready";
  }

  private stateToListId(state: IssueState): string {
    switch (state) {
      case "in_progress":
        return this.getListId(this.lists.in_progress);
      case "review":
        return this.getListId(this.lists.review);
      case "done":
        return this.getListId(this.lists.done);
      case "failed":
        return this.getListId(this.lists.failed);
      case "blocked":
        return this.getListId(this.lists.in_progress);
      case "unfinished":
        if (this.lists.unfinished) return this.getListId(this.lists.unfinished);
        return this.getListId(this.lists.ready);
      default:
        return this.getListId(this.lists.ready);
    }
  }

  async transitionTo(issueId: string, state: IssueState): Promise<void> {
    const idList = this.stateToListId(state);
    await trelloFetch(
      `/cards/${issueId}?idList=${idList}`,
      this.key,
      this.token,
      { method: "PUT" }
    );
  }

  async postComment(issueId: string, text: string): Promise<void> {
    const encoded = encodeURIComponent(text);
    await trelloFetch(
      `/cards/${issueId}/actions/comments?text=${encoded}`,
      this.key,
      this.token,
      { method: "POST" }
    );
  }

  async updateChecklist(
    issueId: string,
    itemId: string,
    checked: boolean
  ): Promise<void> {
    const checklists = await trelloFetch<TrelloChecklist[]>(
      `/cards/${issueId}/checklists`,
      this.key,
      this.token
    );
    for (const cl of checklists) {
      const item = cl.checkItems.find((ci) => ci.id === itemId);
      if (item) {
        const state = checked ? "complete" : "incomplete";
        await trelloFetch(
          `/cards/${issueId}/checklist/${cl.id}/checkItem/${itemId}?state=${state}`,
          this.key,
          this.token,
          { method: "PUT" }
        );
        return;
      }
    }
    throw new Error(`Checklist item ${itemId} not found on card ${issueId}`);
  }

  async addLabel(issueId: string, label: string): Promise<void> {
    const boardLabels = await trelloFetch<TrelloLabel[]>(
      `/boards/${this.boardId}/labels`,
      this.key,
      this.token
    );
    const match = boardLabels.find(
      (l) => l.name.toLowerCase() === label.toLowerCase()
    );
    if (match) {
      await trelloFetch(
        `/cards/${issueId}/idLabels?value=${match.id}`,
        this.key,
        this.token,
        { method: "POST" }
      );
    } else {
      const created = await trelloFetch<TrelloLabel>(
        `/boards/${this.boardId}/labels?name=${encodeURIComponent(label)}`,
        this.key,
        this.token,
        { method: "POST" }
      );
      await trelloFetch(
        `/cards/${issueId}/idLabels?value=${created.id}`,
        this.key,
        this.token,
        { method: "POST" }
      );
    }
  }

  async removeLabel(issueId: string, label: string): Promise<void> {
    const boardLabels = await trelloFetch<TrelloLabel[]>(
      `/boards/${this.boardId}/labels`,
      this.key,
      this.token
    );
    const match = boardLabels.find(
      (l) => l.name.toLowerCase() === label.toLowerCase()
    );
    if (match) {
      await trelloFetch(
        `/cards/${issueId}/idLabels/${match.id}`,
        this.key,
        this.token,
        { method: "DELETE" }
      );
    }
  }

  async createCard(params: {
    listName: string;
    title: string;
    description?: string;
  }): Promise<Issue> {
    await this.refreshListMap();
    const idList = this.getListId(params.listName);
    const body: Record<string, string> = {
      name: params.title,
      idList,
    };
    if (params.description) body.desc = params.description;

    const card = await trelloFetch<TrelloCard>(
      `/cards`,
      this.key,
      this.token,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return this.normalizeCard(card);
  }

  async createList(name: string): Promise<{ id: string; name: string }> {
    const list = await trelloFetch<TrelloList>(
      `/lists?name=${encodeURIComponent(name)}&idBoard=${this.boardId}`,
      this.key,
      this.token,
      { method: "POST" }
    );
    this.listIdMap.set(list.name, list.id);
    return { id: list.id, name: list.name };
  }
}

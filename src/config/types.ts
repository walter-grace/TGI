/**
 * TGI configuration and domain types.
 * All interfaces are tracker-agnostic; no Trello/Jira/etc. specifics here.
 */

// --- Tracker-agnostic normalized models ---

export interface ChecklistItem {
  id: string;
  name: string;
  checked: boolean;
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export type IssueState =
  | "ready"
  | "in_progress"
  | "review"
  | "done"
  | "failed"
  | "blocked"
  | "unfinished";

/**
 * Normalized Issue model. The entire core engine works with this.
 * NEVER contains tracker-specific fields at the top level.
 */
export interface Issue {
  id: string;
  trackerId: string;
  trackerKind: string;
  identifier: string;
  title: string;
  description: string;
  labels: string[];
  checklist: ChecklistItem[];
  comments: Comment[];
  assignee: string | null;
  dueDate: string | null;
  status: IssueState;
  url: string;
  metadata: Record<string, unknown>;
  /** Override model for this task (from label "model:provider/model" or task creation) */
  model?: string;
}

// --- ITracker interface (THE critical abstraction) ---

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
}

// --- Tracker config (from WORKFLOW.md frontmatter) ---

export interface TrackerListConfig {
  ready: string;
  in_progress: string;
  review: string;
  done: string;
  failed: string;
  /** Optional. When set, cards that hit max turns are moved here and re-picked for continuation. */
  unfinished?: string;
  /** Optional. When set, cards in this list are auto-tagged with "self-heal" label and polled as ready. */
  self_healing?: string;
}

export interface TrelloTrackerConfig {
  kind: "trello";
  id: string;
  board_id: string;
  api_key_env: string;
  api_token_env: string;
  lists: TrackerListConfig;
  poll_interval_seconds?: number;
  label_filters?: string[];
}

export interface NotionTrackerConfig {
  kind: "notion";
  id: string;
  database_id: string;
  api_key_env: string;
  /** Name of the Status property in the Notion database (default: "Status") */
  status_property?: string;
  /** Name of the Title property (default: "Name") */
  title_property?: string;
  /** Name of the multi-select Labels property (default: "Labels") */
  labels_property?: string;
  /** Maps IssueState values to Notion status names */
  statuses: TrackerListConfig;
  poll_interval_seconds?: number;
  label_filters?: string[];
}

export interface LinearTrackerConfig {
  kind: "linear";
  id: string;
  team_key: string;
  api_key_env: string;
  statuses: TrackerListConfig;
  poll_interval_seconds?: number;
  label_filters?: string[];
}

export interface GitHubTrackerConfig {
  kind: "github";
  id: string;
  owner: string;
  repo: string;
  api_token_env: string;
  labels: TrackerListConfig;
  poll_interval_seconds?: number;
  label_filters?: string[];
}

export interface HubSpotTrackerConfig {
  kind: "hubspot";
  id: string;
  api_token_env: string;
  pipeline_id: string;
  object_type?: string;
  stages: TrackerListConfig;
  poll_interval_seconds?: number;
  label_filters?: string[];
}

export interface TrackerConfig {
  kind: string;
  id: string;
  [key: string]: unknown;
}

// --- Workspace config ---

export interface WorkspaceConfig {
  root: string;
  /** Keep workspace after completion (default: true). Set false to delete on done/failed. */
  keep_workspace?: boolean;
  /** Optional repo URL to clone. Use {{issue.identifier}} in the URL. Creates branch agent/{{issue.identifier}}. */
  repo_url?: string;
  hooks?: {
    after_create?: string;
    before_remove?: string;
  };
}

// --- Agent config ---

export interface ExperimentModeConfig {
  enabled: boolean;
  max_iterations: number;
  time_budget_minutes: number;
  eval_command: string;
  metric_key: string;
  direction: "maximize" | "minimize";
}

export interface AgentConfig {
  provider: string;
  model: string;
  /** Optional list of models for dashboard dropdown. If unset, uses default popular models. */
  available_models?: string[];
  /** Env var for API key (e.g. OPENAI_API_KEY). Used by openai provider; others use provider-specific defaults. */
  api_key_env?: string;
  /** Base URL for OpenAI-compatible APIs (openai provider). Enables Azure, Bedrock proxy, vLLM, etc. */
  base_url?: string;
  max_concurrent_agents: number;
  max_turns: number;
  timeout_minutes: number;
  experiment_mode?: ExperimentModeConfig;
}

// --- Server config ---

export interface ServerConfig {
  port: number;
  cors_origins: string[];
}

// --- Skills config ---

export interface SkillsConfig {
  directory: string;
  default: string[];
  label_map: Record<string, string[]>;
}

// --- Full config ---

export interface WorkflowConfig {
  trackers: TrackerConfig[];
  workspace: WorkspaceConfig;
  agent: AgentConfig;
  server: ServerConfig;
  skills: SkillsConfig;
}

// --- Session state ---

export type SessionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "blocked";

export interface ExperimentLogEntry {
  iteration: number;
  result: unknown;
  kept: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface AgentSession {
  id: string;
  issue: Issue;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  logs: string[];
  experimentLog?: ExperimentLogEntry[];
  error?: string;
  turnCount?: number;
  tokenUsage?: TokenUsage;
  browserLiveUrl?: string;
  browserSessionId?: string;
  writtenFiles?: string[];
}

// --- API DTOs ---

export interface StatusResponse {
  ok: boolean;
  queueSize: number;
  activeCount: number;
  connectedTrackers: { id: string; kind: string; healthy: boolean }[];
}

export interface SessionResponse {
  id: string;
  trackerKind: string;
  trackerId: string;
  issueIdentifier: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  turnCount?: number;
  error?: string;
}

export interface AssignRequest {
  trackerId: string;
  issueId: string;
  profile?: string;
}

export interface TrackerInfo {
  id: string;
  kind: string;
  healthy: boolean;
}

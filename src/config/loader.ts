/**
 * Parse WORKFLOW.md with gray-matter (YAML frontmatter + body template).
 * Resolves env vars and validates trackers[] shape.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import matter from "gray-matter";
import type {
  WorkflowConfig,
  TrackerConfig,
  WorkspaceConfig,
  AgentConfig,
  ServerConfig,
  SkillsConfig,
} from "./types.js";

const DEFAULT_WORKSPACE: WorkspaceConfig = {
  root: "~/workspaces/tgi",
  hooks: {},
};

const DEFAULT_AGENT: AgentConfig = {
  provider: "openrouter",
  model: "moonshotai/kimi-k2.5",
  max_concurrent_agents: 5,
  max_turns: 30,
  timeout_minutes: 60,
  experiment_mode: {
    enabled: true,
    max_iterations: 20,
    time_budget_minutes: 30,
    eval_command: "npm test",
    metric_key: "score",
    direction: "maximize",
  },
};

const DEFAULT_SERVER: ServerConfig = {
  port: 3199,
  cors_origins: ["*"],
};

const DEFAULT_SKILLS: SkillsConfig = {
  directory: ".symphony/skills",
  default: ["git", "code"],
  label_map: {
    research: ["git", "code", "research", "web-search"],
    bug: ["git", "code", "test", "debug"],
    feature: ["git", "code", "test"],
    devops: ["git", "deploy", "infra"],
  },
};

function resolveEnv(key: string): string {
  const val = process.env[key];
  if (val === undefined || val === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return resolve(home, path.slice(2));
  }
  return resolve(path);
}

export interface LoadedWorkflow {
  config: WorkflowConfig;
  templateBody: string;
  workflowPath: string;
}

export function loadWorkflow(path: string = "WORKFLOW.md"): LoadedWorkflow {
  const workflowPath = resolve(process.cwd(), path);
  const raw = readFileSync(workflowPath, "utf-8");
  const { data, content } = matter(raw);

  const trackers = (data.trackers ?? []) as TrackerConfig[];
  if (!Array.isArray(trackers)) {
    throw new Error("WORKFLOW.md: trackers must be an array");
  }

  const config: WorkflowConfig = {
    trackers,
    workspace: { ...DEFAULT_WORKSPACE, ...data.workspace },
    agent: { ...DEFAULT_AGENT, ...data.agent },
    server: { ...DEFAULT_SERVER, ...data.server },
    skills: { ...DEFAULT_SKILLS, ...data.skills },
  };

  if (config.workspace.root) {
    config.workspace.root = expandPath(config.workspace.root);
  }

  return {
    config,
    templateBody: content.trim(),
    workflowPath,
  };
}

/**
 * Resolve env var name from tracker config (e.g. api_key_env -> value from process.env).
 */
export function getEnvFromConfig(configKey: string): string {
  return resolveEnv(configKey);
}

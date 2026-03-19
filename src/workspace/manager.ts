/**
 * Workspace Manager — per-issue workspace isolation.
 * Path format: {root}/{trackerKind}-{issueId}/ to avoid collisions across trackers.
 * Pattern: Symphony SPEC.md workspace layer
 */

import { mkdir, rm, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Issue } from "../config/types.js";
import type { WorkspaceConfig } from "../config/types.js";
import { runAfterCreate, runBeforeRemove } from "./hooks.js";
import { runInDir } from "../utils/shell.js";
import { renderTemplate } from "../utils/template.js";

export function getWorkspacePath(root: string, issue: Issue): string {
  const safeId = issue.id.replace(/[/\\]/g, "-");
  return join(root, `${issue.trackerKind}-${safeId}`);
}

/**
 * Write .env file to workspace so agent scripts can use real credentials.
 * Never use demo/mock mode — execute for real.
 */
async function writeWorkspaceEnv(
  workspacePath: string,
  vars: Record<string, string>
): Promise<void> {
  const lines = Object.entries(vars)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v.replace(/\n/g, "\\n")}`);
  await writeFile(join(workspacePath, ".env"), lines.join("\n") + "\n", "utf-8");
}

export async function createWorkspace(
  config: WorkspaceConfig,
  issue: Issue,
  vars?: Record<string, string>
): Promise<string> {
  const path = getWorkspacePath(config.root, issue);
  await mkdir(path, { recursive: true });
  if (vars && Object.keys(vars).length > 0) {
    await writeWorkspaceEnv(path, vars);
  }

  if (config.repo_url) {
    const repoUrl = renderTemplate(config.repo_url, { issue, workspacePath: path, ...vars });
    const branch = `agent/${issue.identifier}`;
    await runInDir(path, `git clone ${repoUrl} .`, 120_000);
    await runInDir(path, `git checkout -b ${branch}`, 30_000);
  }

  if (config.hooks?.after_create) {
    await runAfterCreate(path, issue, config.hooks.after_create, vars);
  }
  return path;
}

export async function removeWorkspace(
  config: WorkspaceConfig,
  issue: Issue,
  vars?: Record<string, string>
): Promise<void> {
  const path = getWorkspacePath(config.root, issue);
  try {
    if (config.hooks?.before_remove) {
      await runBeforeRemove(path, issue, config.hooks.before_remove, vars);
    }
  } finally {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // ignore if already gone
    }
  }
}

export async function workspaceExists(root: string, issue: Issue): Promise<boolean> {
  const path = getWorkspacePath(root, issue);
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

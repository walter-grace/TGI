/**
 * Lifecycle hooks for workspace (after_create, before_remove).
 * Renders hook scripts with Handlebars using issue/workspace context.
 */

import { renderTemplate } from "../utils/template.js";
import { runInDir } from "../utils/shell.js";
import type { Issue } from "../config/types.js";

export interface HookContext {
  issue: Issue;
  workspacePath: string;
  repo_url?: string;
}

export async function runAfterCreate(
  workspacePath: string,
  issue: Issue,
  script: string,
  vars?: Record<string, string>
): Promise<void> {
  const context: Record<string, unknown> = {
    issue,
    workspacePath,
    repo_url: vars?.repo_url ?? "",
    ...vars,
  };
  const rendered = renderTemplate(script, context);
  const lines = rendered.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    await runInDir(workspacePath, line, 120_000);
  }
}

export async function runBeforeRemove(
  workspacePath: string,
  _issue: Issue,
  script: string,
  vars?: Record<string, string>
): Promise<void> {
  const context: Record<string, unknown> = {
    issue: _issue,
    workspacePath,
    ...vars,
  };
  const rendered = renderTemplate(script, context);
  const lines = rendered.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    await runInDir(workspacePath, line, 30_000);
  }
}

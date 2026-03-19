/**
 * Build agent prompt from WORKFLOW.md template + issue + skills.
 */

import { renderTemplate } from "../utils/template.js";
import type { Issue } from "../config/types.js";
import type { WorkflowConfig } from "../config/types.js";
import { getSkillContents } from "../skills/resolver.js";
import { resolveSkillsForLabels } from "../skills/resolver.js";

export interface ExperimentContext {
  iteration: number;
  previousReverted: boolean;
}

export function buildPrompt(
  templateBody: string,
  config: WorkflowConfig,
  issue: Issue,
  attempt?: number,
  experimentContext?: ExperimentContext
): string {
  const skillNames = resolveSkillsForLabels(config.skills, issue.labels);
  const skillContents = getSkillContents(skillNames, config.skills.directory);

  const skillsForPrompt = Array.from(skillContents.entries()).map(
    ([name, content]) => `### ${name}\n${content}`
  );

  const context: Record<string, unknown> = {
    issue: {
      ...issue,
      hasComments: issue.comments.length > 0,
    },
    skills: skillNames,
    skillsContent: skillsForPrompt.join("\n\n"),
    agent: config.agent,
    attempt,
    experimentContext,
  };

  return renderTemplate(templateBody, context);
}

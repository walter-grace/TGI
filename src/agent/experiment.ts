/**
 * Autoresearch-style experiment loop.
 * Pattern: https://github.com/karpathy/autoresearch
 * Hypothesize -> implement -> evaluate -> keep/discard.
 */

import type { Issue } from "../config/types.js";
import type { ITracker } from "../tracker/interface.js";
import type { ExperimentModeConfig } from "../config/types.js";
import { runInDir } from "../utils/shell.js";
import { logger } from "../observability/logger.js";

export interface ExperimentLogEntry {
  iteration: number;
  result: unknown;
  kept: boolean;
}

export async function runExperimentLoop(
  workspacePath: string,
  issue: Issue,
  tracker: ITracker,
  config: ExperimentModeConfig,
  onIteration: (iteration: number, previousReverted: boolean) => Promise<void>
): Promise<ExperimentLogEntry[]> {
  const log: ExperimentLogEntry[] = [];
  const startTime = Date.now();
  const budgetMs = config.time_budget_minutes * 60 * 1000;

  const runEval = async (): Promise<number> => {
    const result = await runInDir(workspacePath, config.eval_command, 120_000);
    const output = result.stdout + result.stderr;
    const match = output.match(
      new RegExp(`${config.metric_key}\\s*[:=]\\s*([\\d.]+)`, "i")
    );
    if (match) return parseFloat(match[1]);
    return 0;
  };

  let baseline = await runEval();
  logger.info(`Experiment baseline: ${baseline}`, { issueId: issue.id });

  let previousReverted = false;

  for (let i = 0; i < config.max_iterations; i++) {
    if (Date.now() - startTime > budgetMs) {
      logger.info("Experiment time budget exhausted", { issueId: issue.id });
      break;
    }

    await onIteration(i, previousReverted);

    const result = await runEval();
    const improved =
      config.direction === "maximize"
        ? result > baseline
        : result < baseline;

    if (improved) {
      baseline = result;
      previousReverted = false;
      log.push({ iteration: i, result, kept: true });
      await tracker.postComment(
        issue.id,
        `🔬 Experiment ${i}: improved ${config.metric_key}=${result}`
      );
    } else {
      log.push({ iteration: i, result, kept: false });
      previousReverted = true;
      try {
        await runInDir(workspacePath, "git reset --hard HEAD", 30_000);
        logger.info("Reverted workspace after non-improving experiment", { iteration: i });
      } catch {
        logger.warn("Could not revert workspace (git reset failed)", { iteration: i });
      }
    }
  }

  return log;
}

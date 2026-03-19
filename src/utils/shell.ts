/**
 * Safe shell execution scoped to workspace directory.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runInDir(
  cwd: string,
  command: string,
  timeoutMs = 60_000
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: e.code ?? 1,
    };
  }
}

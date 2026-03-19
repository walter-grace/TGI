/**
 * Structured logger for daemon.
 */

const LEVEL = (process.env.TGI_LOG_LEVEL ?? process.env.SYMPHONY_LOG_LEVEL ?? "info").toLowerCase();

const levels = ["debug", "info", "warn", "error"] as const;
const levelIndex = levels.indexOf(LEVEL as (typeof levels)[number]);
const minIndex = levelIndex >= 0 ? levelIndex : 1;

function shouldLog(level: string): boolean {
  const i = levels.indexOf(level as (typeof levels)[number]);
  return i >= 0 && i >= minIndex;
}

function format(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${level.toUpperCase()}] ${msg}${metaStr}`;
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog("debug")) console.debug(format("debug", msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog("info")) console.info(format("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(format("warn", msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog("error")) console.error(format("error", msg, meta));
  },
};

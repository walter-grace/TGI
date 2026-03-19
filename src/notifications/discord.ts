/**
 * Discord webhook notifications for session events.
 * Set DISCORD_WEBHOOK_URL in env to enable.
 */

import { logger } from "../observability/logger.js";

export async function notifyDiscord(
  message: string,
  opts?: { webhookUrl?: string }
): Promise<void> {
  const url = opts?.webhookUrl ?? process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
    if (!res.ok) {
      logger.warn("Discord webhook failed", { status: res.status });
    }
  } catch (err) {
    logger.warn("Discord webhook error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

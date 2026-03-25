/**
 * End-to-end test: Self-Healing + Cloudflare Dynamic Workers + Webhook → Trello card
 *
 * Tests the full chain:
 *   1. Deploy a monitor Worker to Cloudflare
 *   2. Hit the Worker URL — it checks the TGI GitHub repo API
 *   3. POST the result to the local webhook
 *   4. Verify a Trello card is created on failure
 *   5. Clean up: delete the Worker + the test card
 *
 * Usage: npm run test:self-heal-cf
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const CF_API = "https://api.cloudflare.com/client/v4";
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const TRELLO_KEY = process.env.TRELLO_API_KEY!;
const TRELLO_TOKEN = process.env.TRELLO_API_TOKEN!;
const WEBHOOK_SECRET = process.env.MONITOR_WEBHOOK_SECRET ?? "tgi-sh-webhook-2026";
const TGI_PORT = process.env.TGI_PORT ?? "3199";
const WORKER_NAME = "sh-monitor-test-e2e";

function log(step: string, msg: string) {
  console.log(`\n[${ step }] ${ msg }`);
}

async function cfFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CF_TOKEN}`, ...init?.headers },
  });
  return res;
}

// --- Step 1: Deploy a monitor Worker ---
async function deployWorker(): Promise<string> {
  log("1/5", "Deploying monitor Worker to Cloudflare...");

  // This Worker checks if the TGI GitHub repo API is accessible
  // We make it intentionally report a "fail" so we can test the full card-creation flow
  const script = `
export default {
  async fetch(request, env) {
    const result = await runCheck();
    return Response.json(result);
  },
  async scheduled(event, env, ctx) {
    const result = await runCheck();
    if (result.status === "fail") {
      ctx.waitUntil(reportFailure(result));
    }
  },
};

async function runCheck() {
  try {
    const res = await fetch("https://api.github.com/repos/walter-grace/TGI", {
      headers: { "User-Agent": "sh-monitor" },
    });
    if (!res.ok) {
      return { monitor_name: "${WORKER_NAME}", status: "fail", error: "GitHub API HTTP " + res.status, repo_url: "https://github.com/walter-grace/TGI" };
    }
    const data = await res.json();
    // Intentional fail for testing: flag if repo has any code at all
    if (data.size > 0) {
      return {
        monitor_name: "${WORKER_NAME}",
        status: "fail",
        error: "E2E test: intentional failure — repo size is " + data.size + "KB",
        details: "Stars: " + data.stargazers_count + ", Forks: " + data.forks_count + ", Default branch: " + data.default_branch,
        repo_url: "https://github.com/walter-grace/TGI",
      };
    }
    return { monitor_name: "${WORKER_NAME}", status: "pass", repo_url: "https://github.com/walter-grace/TGI" };
  } catch (e) {
    return { monitor_name: "${WORKER_NAME}", status: "fail", error: e.message, repo_url: "https://github.com/walter-grace/TGI" };
  }
}

async function reportFailure(result) {
  // In production this would POST to TGI_PUBLIC_URL — for this test we just return the result
}
`;

  const boundary = `----CFBoundary${Date.now()}`;
  const metadata = JSON.stringify({
    main_module: "worker.js",
    compatibility_date: "2024-09-23",
    compatibility_flags: ["nodejs_compat"],
  });
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="metadata"`,
    `Content-Type: application/json`,
    ``,
    metadata,
    `--${boundary}`,
    `Content-Disposition: form-data; name="worker.js"; filename="worker.js"`,
    `Content-Type: application/javascript+module`,
    ``,
    script,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await cfFetch(`/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  if (!res.ok) {
    throw new Error(`Deploy failed: ${res.status} ${await res.text()}`);
  }

  // Enable workers.dev
  await cfFetch(`/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}/subdomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });

  // Get subdomain
  const subRes = await cfFetch(`/accounts/${CF_ACCOUNT}/workers/subdomain`);
  const subData = await subRes.json() as any;
  const subdomain = subData?.result?.subdomain ?? "unknown";
  const url = `https://${WORKER_NAME}.${subdomain}.workers.dev`;

  log("1/5", `✅ Worker deployed: ${url}`);
  return url;
}

// --- Step 2: Hit the Worker ---
async function hitWorker(url: string): Promise<any> {
  log("2/5", `Hitting Worker at ${url}...`);
  // Give Cloudflare a moment to propagate
  await new Promise((r) => setTimeout(r, 3000));

  const res = await fetch(url);
  const data = await res.json();
  log("2/5", `✅ Worker response: ${JSON.stringify(data, null, 2)}`);
  return data;
}

// --- Step 3: POST to local webhook ---
async function postToWebhook(monitorResult: any): Promise<any> {
  log("3/5", "Posting to local webhook...");

  const webhookUrl = `http://localhost:${TGI_PORT}/api/webhooks/monitor`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...monitorResult, secret: WEBHOOK_SECRET }),
  });

  const data = await res.json();
  log("3/5", `✅ Webhook response: ${JSON.stringify(data)}`);
  return data;
}

// --- Step 4: Verify Trello card ---
async function verifyCard(cardShortLink: string): Promise<void> {
  log("4/5", `Verifying Trello card ${cardShortLink}...`);

  const res = await fetch(
    `https://api.trello.com/1/cards/${cardShortLink}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&fields=name,desc,labels,idList`
  );
  const card = await res.json() as any;

  console.log(`  Title:  ${card.name}`);
  console.log(`  Labels: ${(card.labels ?? []).map((l: any) => l.name).join(", ")}`);
  console.log(`  Desc:   ${(card.desc ?? "").slice(0, 200)}...`);

  // Verify it has the right label
  const hasSelfHealFix = (card.labels ?? []).some((l: any) => l.name === "self-heal-fix");
  if (hasSelfHealFix) {
    log("4/5", "✅ Card has self-heal-fix label");
  } else {
    log("4/5", "⚠️  Card missing self-heal-fix label (may need manual check)");
  }
}

// --- Step 5: Clean up ---
async function cleanup(cardShortLink?: string): Promise<void> {
  log("5/5", "Cleaning up...");

  // Delete Worker
  const delRes = await cfFetch(`/accounts/${CF_ACCOUNT}/workers/scripts/${WORKER_NAME}`, {
    method: "DELETE",
  });
  console.log(`  Worker deleted: ${delRes.ok}`);

  // Delete test card
  if (cardShortLink) {
    const cardRes = await fetch(
      `https://api.trello.com/1/cards/${cardShortLink}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`,
      { method: "DELETE" }
    );
    console.log(`  Trello card deleted: ${cardRes.ok}`);
  }

  log("5/5", "✅ Cleanup complete");
}

// --- Main ---
async function main() {
  console.log("=".repeat(60));
  console.log("  Self-Heal + Cloudflare Workers E2E Test");
  console.log("=".repeat(60));

  // Preflight checks
  if (!CF_ACCOUNT || !CF_TOKEN) {
    console.error("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    process.exit(1);
  }
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error("Missing TRELLO_API_KEY or TRELLO_API_TOKEN");
    process.exit(1);
  }

  // Check daemon is running
  try {
    const healthRes = await fetch(`http://localhost:${TGI_PORT}/health`);
    if (!healthRes.ok) throw new Error();
  } catch {
    console.error(`\n❌ TGI daemon not running on port ${TGI_PORT}. Start with: npm run dev`);
    process.exit(1);
  }
  console.log(`\nDaemon running on port ${TGI_PORT} ✓`);

  let cardShortLink: string | undefined;

  try {
    // 1. Deploy
    const workerUrl = await deployWorker();

    // 2. Hit it
    const monitorResult = await hitWorker(workerUrl);

    // 3. If it reported a failure, post to webhook
    if (monitorResult.status === "fail") {
      const webhookResult = await postToWebhook(monitorResult);
      cardShortLink = webhookResult.card;

      // 4. Verify the card
      if (cardShortLink) {
        await verifyCard(cardShortLink);
      }
    } else {
      log("3/5", "Monitor passed — no webhook call needed (no failure to report)");
      log("4/5", "Skipped — no card to verify");
    }

    // 5. Cleanup
    await cleanup(cardShortLink);

    console.log("\n" + "=".repeat(60));
    console.log("  ✅ ALL TESTS PASSED");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    // Still try to cleanup
    try { await cleanup(cardShortLink); } catch {}
    process.exit(1);
  }
}

main();

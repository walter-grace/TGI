/**
 * GET /api/status — daemon health, queue size, active count, connected trackers,
 * agent model, integrations (for web dashboard).
 */

import { Router } from "express";
import { getQueueSize, getRunningSessionIds } from "../../orchestrator/state.js";
import { loadWorkflow } from "../../config/loader.js";
import type { TrackerRegistry } from "../../tracker/registry.js";

const DEFAULT_AVAILABLE_MODELS = [
  "moonshotai/kimi-k2.5",
  "xiaomi/mimo-v2-pro",
  "openai/gpt-5.4-nano",
  "google/gemini-3-flash-preview",
];

let cachedAgent: {
  provider: string;
  model: string;
  availableModels: string[];
  base_url?: string;
} | null = null;

function getAgentInfo(): {
  provider: string;
  model: string;
  availableModels: string[];
  base_url?: string;
} {
  if (!cachedAgent) {
    try {
      const { config } = loadWorkflow();
      cachedAgent = {
        provider: config.agent.provider,
        model: config.agent.model,
        availableModels: config.agent.available_models ?? DEFAULT_AVAILABLE_MODELS,
        ...(config.agent.provider === "openai" && config.agent.base_url
          ? { base_url: config.agent.base_url }
          : {}),
      };
    } catch {
      cachedAgent = { provider: "unknown", model: "unknown", availableModels: DEFAULT_AVAILABLE_MODELS };
    }
  }
  return cachedAgent;
}

function getIntegrations(registry: TrackerRegistry, health: Map<string, boolean>): Array<{ id: string; name: string; kind: string; connected: boolean; healthy: boolean }> {
  const integrations: Array<{ id: string; name: string; kind: string; connected: boolean; healthy: boolean }> = [];
  for (const [id, healthy] of health) {
    const tracker = registry.get(id);
    integrations.push({
      id,
      name: tracker?.kind ?? "unknown",
      kind: "tracker",
      connected: true,
      healthy,
    });
  }
  const stubTrackers = [
    { id: "jira", name: "jira", envKey: "JIRA_API_TOKEN" },
    { id: "linear", name: "linear", envKey: "LINEAR_API_KEY" },
    { id: "github", name: "github", envKey: "GITHUB_TOKEN" },
  ];
  for (const stub of stubTrackers) {
    if (!integrations.some((i) => i.name === stub.name)) {
      integrations.push({
        id: stub.id,
        name: stub.name,
        kind: "tracker",
        connected: !!process.env[stub.envKey],
        healthy: false,
      });
    }
  }
  return integrations;
}

export function createStatusRouter(registry: TrackerRegistry): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const health = await registry.healthCheckAll();
    const connectedTrackers = Array.from(health.entries()).map(
      ([id, healthy]) => {
        const tracker = registry.get(id);
        return {
          id,
          kind: tracker?.kind ?? "unknown",
          healthy,
        };
      }
    );

    const agent = getAgentInfo();
    const integrations = getIntegrations(registry, health);

    res.json({
      ok: true,
      queueSize: getQueueSize(),
      activeCount: getRunningSessionIds().length,
      connectedTrackers,
      integrations,
      agent: {
        provider: agent.provider,
        model: agent.model,
        availableModels: agent.availableModels,
        base_url: agent.base_url,
      },
    });
  });

  return router;
}
export default createStatusRouter;

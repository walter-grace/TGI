/**
 * Provider registry — pluggable agent backends.
 * Enterprises can register custom providers via registerProvider().
 */

import type { IAgentProvider } from "./interface.js";
import type { WorkflowConfig } from "../../config/types.js";
import { OpenRouterProvider } from "./openrouter.js";
import { ClaudeProvider } from "./claude.js";
import { OpenAIProvider } from "./openai.js";

type ProviderFactory = (config: WorkflowConfig) => IAgentProvider;

const factories = new Map<string, ProviderFactory>();

function register(name: string, factory: ProviderFactory): void {
  factories.set(name, factory);
}

function createProvider(config: WorkflowConfig): IAgentProvider {
  const factory = factories.get(config.agent.provider);
  if (!factory) {
    throw new Error(
      `Unknown agent provider: "${config.agent.provider}". ` +
        `Available: ${[...factories.keys()].join(", ")}. ` +
        `Use registerProvider() to add custom providers.`
    );
  }
  return factory(config);
}

// Built-in providers
register("openrouter", () => new OpenRouterProvider());
register("claude", () => new ClaudeProvider());
register("openai", (config) => new OpenAIProvider(config.agent));

export { register as registerProvider, createProvider };

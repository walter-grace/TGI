/**
 * Generic OpenAI-compatible provider.
 * Works with OpenAI, Azure OpenAI, AWS Bedrock (via proxy), vLLM, Ollama, etc.
 * Configure base_url and api_key_env in WORKFLOW.md.
 */

import type {
  IAgentProvider,
  AgentMessage,
  AgentResponse,
  ToolDefinition,
  ToolUse,
} from "./interface.js";
import type { AgentConfig } from "../../config/types.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toOpenAIMessages(messages: AgentMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content });
      continue;
    }
    const textBlocks = m.content.filter((b) => b.type === "text");
    const toolUseBlocks = m.content.filter((b) => b.type === "tool_use");
    const toolResultBlocks = m.content.filter((b) => b.type === "tool_result");

    if (toolUseBlocks.length > 0) {
      const content = textBlocks.map((b) => (b as { text: string }).text).join("\n") || undefined;
      result.push({
        role: "assistant",
        content: content || undefined,
        tool_calls: toolUseBlocks.map((b) => {
          const u = b as { id: string; name: string; input: unknown };
          return {
            id: u.id,
            type: "function" as const,
            function: {
              name: u.name,
              arguments: JSON.stringify(u.input as Record<string, unknown>),
            },
          };
        }),
      });
    } else if (textBlocks.length > 0) {
      result.push({
        role: m.role,
        content: textBlocks.map((b) => (b as { text: string }).text).join("\n"),
      });
    }
    for (const b of toolResultBlocks) {
      const r = b as { tool_use_id: string; content: string };
      result.push({
        role: "tool",
        content: r.content,
        tool_call_id: r.tool_use_id,
      });
    }
  }
  return result;
}

function toOpenAITools(tools: ToolDefinition[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: object };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export class OpenAIProvider implements IAgentProvider {
  private baseUrl: string;
  private apiKeyEnv: string;

  constructor(config: AgentConfig) {
    this.baseUrl = (config.base_url ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKeyEnv = config.api_key_env ?? "OPENAI_API_KEY";
  }

  private getApiKey(): string {
    const key = process.env[this.apiKeyEnv];
    if (!key) throw new Error(`${this.apiKeyEnv} is required for provider "openai"`);
    return key;
  }

  async complete(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options: { model: string; maxTokens: number; signal?: AbortSignal }
  ): Promise<AgentResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const openAIMessages = toOpenAIMessages(messages);
    const openAITools = toOpenAITools(tools);

    const response = await fetch(url, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.getApiKey()}`,
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        messages: openAIMessages,
        tools: openAITools,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI-compatible API ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined;
    if (!choice?.message) {
      return { content: "", stopReason: "end_turn" };
    }

    const msg = choice.message;
    const content = msg.content ?? "";
    const finishReason = choice.finish_reason ?? "stop";

    const toolUses: ToolUse[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: (() => {
        try {
          return JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    }));

    const stopReason: AgentResponse["stopReason"] =
      finishReason === "tool_calls" || toolUses.length > 0
        ? "tool_use"
        : finishReason === "length"
          ? "max_tokens"
          : "end_turn";

    return {
      content,
      stopReason,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      usage,
    };
  }
}

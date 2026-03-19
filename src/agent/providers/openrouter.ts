/**
 * OpenRouter provider — unified API for 300+ LLM models.
 * https://openrouter.ai/docs
 * Uses OpenAI-compatible chat completions format.
 */

import type {
  IAgentProvider,
  AgentMessage,
  AgentResponse,
  ToolDefinition,
  ToolUse,
} from "./interface.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required");
  return key;
}

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

export class OpenRouterProvider implements IAgentProvider {
  async complete(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options: { model: string; maxTokens: number; signal?: AbortSignal }
  ): Promise<AgentResponse> {
    const openAIMessages = toOpenAIMessages(messages);
    const openAITools = toOpenAITools(tools);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
        "HTTP-Referer": "https://github.com/tgi",
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
      throw new Error(`OpenRouter API ${response.status}: ${err}`);
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
        total_cost?: number;
      };
    };

    const choice = data.choices?.[0];
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
          cost: data.usage.total_cost,
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

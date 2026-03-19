/**
 * Anthropic Claude provider.
 * https://github.com/anthropics/anthropic-sdk-node
 * https://docs.anthropic.com/en/api/messages
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  IAgentProvider,
  AgentMessage,
  AgentResponse,
  ToolDefinition,
  ToolUse,
} from "./interface.js";

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is required");
  return key;
}

export class ClaudeProvider implements IAgentProvider {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: getApiKey() });
  }

  async complete(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options: { model: string; maxTokens: number; signal?: AbortSignal }
  ): Promise<AgentResponse> {
    const anthropicMessages = messages.map((m) => {
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content.map((b) => {
              if (b.type === "tool_result") {
                return {
                  type: "tool_result" as const,
                  tool_use_id: b.tool_use_id,
                  content: b.content,
                };
              }
              if (b.type === "tool_use") {
                return {
                  type: "tool_use" as const,
                  id: b.id,
                  name: b.name,
                  input: b.input,
                };
              }
              return { type: "text" as const, text: b.text };
            });
      return {
        role: m.role as "user" | "assistant",
        content,
      };
    });

    const response = await this.client.messages.create(
      {
        model: options.model,
        max_tokens: options.maxTokens,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        messages: anthropicMessages,
      },
      { signal: options.signal }
    );

    const textParts = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text);
    const content = textParts.join("\n");

    const toolUses: ToolUse[] = response.content
      .filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: unknown } =>
          b.type === "tool_use"
      )
      .map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }));

    const stopReason: AgentResponse["stopReason"] =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    return {
      content,
      stopReason,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    };
  }
}

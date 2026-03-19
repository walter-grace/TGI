/**
 * IAgentProvider — pluggable LLM backend.
 */

export type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
      | { type: "tool_result"; tool_use_id: string; content: string }
    >;

export interface AgentMessage {
  role: "user" | "assistant";
  content: MessageContent;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface AgentResponse {
  content: string;
  stopReason: "end_turn" | "max_tokens" | "tool_use";
  toolUses?: ToolUse[];
  usage?: TokenUsage;
}

export interface IAgentProvider {
  complete(
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options: { model: string; maxTokens: number; signal?: AbortSignal }
  ): Promise<AgentResponse>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

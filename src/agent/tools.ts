/**
 * Tool definitions for agent — tracker-generic.
 * https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */

import type { ToolDefinition } from "./providers/interface.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "execute_command",
    description: "Execute a shell command in the workspace directory",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read contents of a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from workspace root" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from workspace root" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "tracker_comment",
    description: "Post a comment on the source ticket in the tracker",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Comment text" },
      },
      required: ["text"],
    },
  },
  {
    name: "tracker_transition",
    description: "Move the issue to a new state in the source tracker",
    input_schema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          description:
            "Target state: in_progress, review, done, failed, blocked. Use blocked when stuck with no path forward.",
        },
      },
      required: ["state"],
    },
  },
  {
    name: "tracker_check_item",
    description:
      "Check or uncheck a checklist item on the source ticket. Use the item's ID from issue.checklist, or the item name (matched case-insensitively).",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "Checklist item ID (e.g. 69b8a...) or item name for lookup",
        },
        checked: { type: "boolean", description: "Whether the item is checked" },
      },
      required: ["item_id", "checked"],
    },
  },
  {
    name: "tracker_create_card",
    description:
      "Create a new card in the tracker. Use when breaking work into subtasks, adding follow-ups, or creating tasks for yourself. Put new cards in the Ready For Agent list so they get picked up, unless you are intentionally creating an index card in a dedicated list like `Skills`.",
    input_schema: {
      type: "object",
      properties: {
        list_name: {
          type: "string",
          description:
            "List name (e.g. Ready For Agent, Doing, Done). Use Ready For Agent for new tasks.",
        },
        title: { type: "string", description: "Card title" },
        description: {
          type: "string",
          description: "Optional card description",
        },
      },
      required: ["list_name", "title"],
    },
  },
  {
    name: "tracker_create_list",
    description:
      "Create a new list on the board. Use when organizing work into new columns.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name" },
      },
      required: ["name"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web. Requires TAVILY_API_KEY. Returns up to 5 results with title, URL, and content.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
];

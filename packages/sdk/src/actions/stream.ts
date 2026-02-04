/** Stream Action */

export const StreamAction = "stream" as const;

// --- Content block types (re-exported from pi-ai, the single source of truth) ---

import type {
  TextContent,
  ThinkingContent,
  ToolCall,
  ImageContent,
} from "@mariozechner/pi-ai";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

export type { TextContent, ThinkingContent, ToolCall, ImageContent };
export type { AgentEvent };

/** Backward-compatible aliases */
export type TextBlock = TextContent;
export type ThinkingBlock = ThinkingContent;
export type ToolCallBlock = ToolCall;
export type ContentBlock = TextContent | ThinkingContent | ToolCall | ImageContent;

// --- Stream event types ---

/**
 * Hub forwards AgentEvent from pi-agent-core as-is.
 * StreamPayload wraps it with routing metadata.
 */
export interface StreamPayload {
  streamId: string;
  agentId: string;
  event: AgentEvent;
}

/** Extract plain text from an AgentEvent that carries a message */
export function extractTextFromEvent(event: AgentEvent): string {
  if (!("message" in event)) return "";
  const msg = event.message;
  if (!msg || !("content" in msg)) return "";
  const content = msg.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

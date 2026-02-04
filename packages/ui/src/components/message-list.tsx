"use client";

import { MemoizedMarkdown } from "@multica/ui/components/markdown";
import { StreamingMarkdown } from "@multica/ui/components/markdown/StreamingMarkdown";
import { cn } from "@multica/ui/lib/utils";
import type { Message } from "@multica/store";

interface MessageListProps {
  messages: Message[]
  streamingIds: Set<string>
}

export function MessageList({ messages, streamingIds }: MessageListProps) {
  return (
    <div className="relative px-4 py-6 space-y-6 max-w-4xl mx-auto">
      {messages.map((msg) => {
        const isStreaming = streamingIds.has(msg.id)
        return (
          <div
            key={msg.id}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                msg.role === "user" ? "bg-muted rounded-md max-w-[60%] p-1 px-2.5" : "w-full p-1 px-2.5"
              )}
            >
              {isStreaming ? (
                <StreamingMarkdown content={msg.content} isStreaming={true} mode="minimal" />
              ) : (
                <MemoizedMarkdown mode="minimal" id={msg.id}>
                  {msg.content}
                </MemoizedMarkdown>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

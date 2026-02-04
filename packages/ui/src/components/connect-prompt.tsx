"use client";

import { useState, useCallback } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { toast } from "@multica/ui/components/ui/sonner";
import {
  useConnectionStore,
  parseConnectionCode,
  saveConnection,
} from "@multica/store";

export function ConnectPrompt() {
  const gwState = useConnectionStore((s) => s.connectionState)
  const [codeInput, setCodeInput] = useState("")

  const handleConnect = useCallback(() => {
    const trimmed = codeInput.trim()
    if (!trimmed) return
    try {
      const info = parseConnectionCode(trimmed)
      saveConnection(info)
      useConnectionStore.getState().connect(info)
      setCodeInput("")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [codeInput])

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">Paste a connection code to start</p>
        {(gwState === "connecting" || gwState === "connected") && (
          <p className="text-xs text-muted-foreground/60 animate-pulse">Connecting...</p>
        )}
      </div>
      <div className="w-full max-w-sm space-y-3">
        <Textarea
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="Paste connection code here..."
          className="text-xs font-mono min-h-[100px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleConnect()
            }
          }}
        />
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={!codeInput.trim() || gwState === "connecting"}
          className="w-full text-xs"
        >
          Connect
        </Button>
      </div>
    </div>
  )
}

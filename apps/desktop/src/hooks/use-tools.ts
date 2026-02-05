import { useState, useEffect, useCallback, useMemo } from 'react'

// ============================================================================
// Types matching the IPC response from main process
// ============================================================================

export interface ToolInfo {
  name: string
  description?: string
  group: string
  enabled: boolean
}

export interface ToolGroup {
  id: string
  name: string
  tools: string[]
}

// Tool descriptions (for UI display)
const TOOL_DESCRIPTIONS: Record<string, string> = {
  read: 'Read file contents',
  write: 'Write content to file',
  edit: 'Edit file with search/replace',
  glob: 'Find files by pattern',
  exec: 'Execute shell commands',
  process: 'Manage background processes',
  web_fetch: 'Fetch content from URLs',
  web_search: 'Search the web via Devv Search',
  memory_get: 'Get stored memory value',
  memory_set: 'Store a memory value',
  memory_delete: 'Delete a memory value',
  memory_list: 'List all memory keys',
}

// Group display names
const GROUP_NAMES: Record<string, string> = {
  fs: 'File System',
  runtime: 'Runtime',
  web: 'Web',
  memory: 'Memory',
  other: 'Other',
}

export interface UseToolsReturn {
  /** List of all tools with their status */
  tools: ToolInfo[]
  /** List of tool groups */
  groups: ToolGroup[]
  /** Loading state */
  loading: boolean
  /** Error state */
  error: string | null

  /** Toggle a specific tool on/off */
  toggleTool: (toolName: string) => Promise<void>
  /** Enable a tool */
  enableTool: (toolName: string) => Promise<void>
  /** Disable a tool */
  disableTool: (toolName: string) => Promise<void>

  /** Refresh tools list from main process */
  refresh: () => Promise<void>

  /** Check if a tool is enabled */
  isToolEnabled: (toolName: string) => boolean
}

/**
 * Hook for managing Agent tools configuration via IPC.
 *
 * This hook communicates with the Electron main process to:
 * - Fetch the list of available tools and their status
 * - Toggle tools on/off (persisted to credentials.json5)
 * - Trigger agent.reloadTools() to apply changes immediately
 */
export function useTools(): UseToolsReturn {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch tools from main process
  const fetchTools = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Use new electronAPI if available, fallback to ipcRenderer
      const result = window.electronAPI
        ? await window.electronAPI.tools.list()
        : await window.ipcRenderer.invoke('tools:list')

      if (Array.isArray(result)) {
        // Add descriptions to tools
        const toolsWithDesc = result.map((tool: { name: string; enabled: boolean; group: string }) => ({
          ...tool,
          description: TOOL_DESCRIPTIONS[tool.name],
        }))
        setTools(toolsWithDesc)
      } else {
        setError('Invalid response from tools:list')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tools')
      // Fallback to empty list
      setTools([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchTools()
  }, [fetchTools])

  // Build groups list from tools
  const groups = useMemo<ToolGroup[]>(() => {
    const groupMap = new Map<string, string[]>()

    for (const tool of tools) {
      const groupTools = groupMap.get(tool.group) || []
      groupTools.push(tool.name)
      groupMap.set(tool.group, groupTools)
    }

    return Array.from(groupMap.entries()).map(([id, toolNames]) => ({
      id,
      name: GROUP_NAMES[id] || id,
      tools: toolNames,
    }))
  }, [tools])

  // Toggle tool via IPC
  const toggleTool = useCallback(async (toolName: string) => {
    console.log('[useTools] toggleTool called:', toolName)
    try {
      const result = window.electronAPI
        ? await window.electronAPI.tools.toggle(toolName)
        : await window.ipcRenderer.invoke('tools:toggle', toolName)

      console.log('[useTools] toggleTool result:', result)

      const typedResult = result as { error?: string; enabled?: boolean }
      if (typedResult.error) {
        console.error('[useTools] toggleTool error:', typedResult.error)
        setError(typedResult.error)
        return
      }

      // Update local state
      console.log('[useTools] Updating tool state:', toolName, 'enabled:', typedResult.enabled)
      setTools((prev) =>
        prev.map((tool) =>
          tool.name === toolName ? { ...tool, enabled: typedResult.enabled ?? !tool.enabled } : tool
        )
      )
    } catch (err) {
      console.error('[useTools] toggleTool exception:', err)
      setError(err instanceof Error ? err.message : 'Failed to toggle tool')
    }
  }, [])

  // Enable tool via IPC
  const enableTool = useCallback(async (toolName: string) => {
    try {
      const result = window.electronAPI
        ? await window.electronAPI.tools.setStatus(toolName, true)
        : await window.ipcRenderer.invoke('tools:setStatus', toolName, true)

      const typedResult = result as { error?: string }
      if (typedResult.error) {
        setError(typedResult.error)
        return
      }

      setTools((prev) =>
        prev.map((tool) =>
          tool.name === toolName ? { ...tool, enabled: true } : tool
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable tool')
    }
  }, [])

  // Disable tool via IPC
  const disableTool = useCallback(async (toolName: string) => {
    try {
      const result = window.electronAPI
        ? await window.electronAPI.tools.setStatus(toolName, false)
        : await window.ipcRenderer.invoke('tools:setStatus', toolName, false)

      const typedResult = result as { error?: string }
      if (typedResult.error) {
        setError(typedResult.error)
        return
      }

      setTools((prev) =>
        prev.map((tool) =>
          tool.name === toolName ? { ...tool, enabled: false } : tool
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable tool')
    }
  }, [])

  // Check if tool is enabled
  const isToolEnabled = useCallback(
    (toolName: string): boolean => {
      const tool = tools.find((t) => t.name === toolName)
      return tool?.enabled ?? false
    },
    [tools]
  )

  return {
    tools,
    groups,
    loading,
    error,
    toggleTool,
    enableTool,
    disableTool,
    refresh: fetchTools,
    isToolEnabled,
  }
}

export default useTools

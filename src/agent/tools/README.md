# Tools System

[中文文档](./README.zh-CN.md)

The tools system provides LLM agents with capabilities to interact with the external world. Tools are the "hands and feet" of an agent - without tools, an LLM can only generate text responses.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Definition                          │
│  (AgentTool from @mariozechner/pi-agent-core)                  │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    name     │  │ description │  │ parameters  │             │
│  │   label     │  │   execute   │  │  (TypeBox)  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    3-Layer Policy Filter                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 1: Global Allow/Deny                               │  │
│  │ User customization via CLI or config                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 2: Provider-Specific                               │  │
│  │ Different rules for different LLM providers              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 3: Subagent Restrictions                           │  │
│  │ Limited tools for spawned child agents                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Filtered Tools                             │
│              (passed to pi-agent-core)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Available Tools

| Tool           | Name             | Description                         |
| -------------- | ---------------- | ----------------------------------- |
| Read           | `read`           | Read file contents                  |
| Write          | `write`          | Write content to files              |
| Edit           | `edit`           | Edit existing files                 |
| Glob           | `glob`           | Find files by pattern               |
| Exec           | `exec`           | Execute shell commands              |
| Process        | `process`        | Manage long-running processes       |
| Web Fetch      | `web_fetch`      | Fetch and extract content from URLs |
| Web Search     | `web_search`     | Search the web via Devv Search      |
| Sessions Spawn | `sessions_spawn` | Spawn a sub-agent session           |

> **Note**: Agents use file-based memory (`memory.md`, `memory/*.md`) via `read` and `edit` tools instead of dedicated memory tools.

## Tool Groups

Groups provide shortcuts for allowing/denying multiple tools at once:

| Group            | Tools                                |
| ---------------- | ------------------------------------ |
| `group:fs`       | read, write, edit, glob              |
| `group:runtime`  | exec, process                        |
| `group:web`      | web_search, web_fetch                |
| `group:subagent` | sessions_spawn                       |
| `group:core`     | All fs, runtime, and web tools       |

## Usage

### CLI Usage

All commands use the unified `multica` CLI (or `pnpm multica` during development).

```bash
# Allow only specific tools
multica run --tools-allow group:fs,group:runtime "list files"

# Deny specific tools
multica run --tools-deny exec,process "read file.txt"

# Use tool groups
multica run --tools-allow group:fs "read config.json"
```

### Programmatic Usage

```typescript
import { Agent } from './runner.js';

const agent = new Agent({
   tools: {
      // Layer 1: Global allow/deny
      allow: ['group:fs', 'group:runtime', 'web_fetch'],
      deny: ['exec'],

      // Layer 2: Provider-specific rules
      byProvider: {
         google: {
            deny: ['exec', 'process'], // Google models can't use runtime tools
         },
      },
   },

   // Layer 3: Subagent mode
   isSubagent: false,
});
```

### Inspecting Tool Configuration

Use the tools CLI to inspect and test configurations:

```bash
# List all available tools
multica tools list

# List tools with allow rules
multica tools list --allow group:fs,group:runtime

# List tools with deny rules
multica tools list --deny exec

# Show all tool groups
multica tools groups
```

## Policy System Details

### Layer 1: Global Allow/Deny

User-specified allow/deny lists:

- `allow`: Only these tools are available (supports group:\* syntax)
- `deny`: These tools are blocked (takes precedence over allow)

If no `allow` list is specified, all tools are available by default.

### Layer 2: Provider-Specific

Different LLM providers may have different capabilities or restrictions:

```typescript
{
  byProvider: {
    google: { deny: ["exec"] },      // Gemini can't execute commands
    anthropic: { allow: ["*"] },     // Claude has full access
  }
}
```

### Layer 3: Subagent Restrictions

When `isSubagent: true`, additional restrictions are applied to prevent spawned agents from accessing sensitive tools like session management.

## Adding New Tools

1. Create a new file in `src/agent/tools/` (e.g., `my-tool.ts`)

2. Define the tool using TypeBox for the schema:

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const MyToolSchema = Type.Object({
   param1: Type.String({ description: 'Parameter description' }),
   param2: Type.Optional(Type.Number()),
});

export function createMyTool(): AgentTool<typeof MyToolSchema> {
   return {
      name: 'my_tool',
      label: 'My Tool',
      description: 'What this tool does',
      parameters: MyToolSchema,
      execute: async (toolCallId, args) => {
         // Implementation
         return { result: 'success' };
      },
   };
}
```

3. Register the tool in `src/agent/tools.ts`:

```typescript
import { createMyTool } from './tools/my-tool.js';

export function createAllTools(cwd: string): AgentTool<any>[] {
   // ... existing tools
   const myTool = createMyTool();

   return [
      ...baseTools,
      myTool as AgentTool<any>,
      // ...
   ];
}
```

4. Add the tool to appropriate groups in `groups.ts`:

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
   'group:my_category': ['my_tool', 'other_tool'],
   // ...
};
```

## Testing

Run the policy system tests:

```bash
pnpm test src/agent/tools/policy.test.ts
```

## Agent Profile Integration

Tools configuration can be defined in Agent Profile's `config.json`, allowing different agents to have different tool capabilities:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Super Multica Hub                          │
│                                                                 │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐              │
│   │  Agent A  │    │  Agent B  │    │  Agent C  │              │
│   │  Profile: │    │  Profile: │    │  Profile: │              │
│   │  coder    │    │  reviewer │    │  devops   │              │
│   │           │    │           │    │           │              │
│   │  tools:   │    │  tools:   │    │  tools:   │              │
│   │  allow:fs │    │  deny:*   │    │  allow:*  │              │
│   └─────┬─────┘    └─────┬─────┘    └─────┬─────┘              │
│         │                │                │                     │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │  Client  │     │  Client  │     │  Client  │
    └──────────┘     └──────────┘     └──────────┘
```

Each Agent's Profile can define its own tools configuration in `config.json`:

```json
{
   "tools": {
      "allow": ["group:fs", "group:runtime"],
      "deny": ["exec"]
   },
   "provider": "anthropic",
   "model": "claude-sonnet-4-20250514"
}
```

See [Profile README](../profile/README.md) for full documentation.

# AI Agent Guidance Files for NEX MCP Server

This directory contains guidance files that enable AI coding assistants to effectively use the `now-sdk-ext-mcp` MCP server for ServiceNow platform automation. While MCP tool descriptions provide basic parameter info, these files give agents the broader context needed to chain tools into effective workflows, understand ServiceNow platform concepts, and write correct server-side scripts.

## What's Included

| File | Purpose | Target |
|------|---------|--------|
| `CLAUDE.md` | Comprehensive tool reference, ServiceNow development guidance, workflows, and decision guides | Claude Code, general-purpose |
| `.cursorrules` | Condensed rule-based guidance optimized for Cursor's context window | Cursor IDE |

## Installation

### Claude Code

**Option A: Project-level (recommended)**

Copy `CLAUDE.md` to your project root. Claude Code automatically loads it at conversation start:

```bash
cp docs/ai-agents/CLAUDE.md /path/to/your/servicenow-project/CLAUDE.md
```

**Option B: Global include**

Add the file path to your Claude Code settings so it applies across all projects:

```bash
# In ~/.claude/settings.json, add to the "includeFiles" array:
{
  "includeFiles": [
    "/path/to/now-sdk-ext-mcp/docs/ai-agents/CLAUDE.md"
  ]
}
```

### Cursor

Copy `.cursorrules` to your project root. Cursor loads it automatically:

```bash
cp docs/ai-agents/.cursorrules /path/to/your/servicenow-project/.cursorrules
```

### Windsurf

Copy `CLAUDE.md` and rename it to `.windsurfrules`:

```bash
cp docs/ai-agents/CLAUDE.md /path/to/your/servicenow-project/.windsurfrules
```

### Other AI Agents

The `CLAUDE.md` content can be used as a system prompt or context file for any AI agent. It is plain markdown and not specific to any particular tool.

## Prerequisites

Before your agent can use the MCP server, ensure:

1. **MCP server is configured** in your AI tool's MCP settings (Claude Desktop, VS Code, Cursor, etc.)
   ```json
   {
     "mcpServers": {
       "servicenow": {
         "command": "npx",
         "args": ["-y", "@sonisoft/now-sdk-ext-mcp"],
         "env": {
           "SN_AUTH_ALIAS": "dev"
         }
       }
     }
   }
   ```

2. **Auth aliases are configured** for your ServiceNow instances
   ```bash
   now-sdk auth add --alias dev --host https://dev12345.service-now.com
   now-sdk auth add --alias prod --host https://prod12345.service-now.com
   ```

3. **Node.js 22+** is available in the environment

## Customization

### Adding Instance-Specific Aliases

Add a section to the guidance file listing your configured aliases:

```markdown
## My Instances
- `dev` — Development (dev12345.service-now.com)
- `test` — Testing (test12345.service-now.com)
- `prod` — Production (prod12345.service-now.com)

Always use instance "dev" for development work unless told otherwise.
```

### Restricting to Specific Tools

If your team only uses certain tool categories, you can trim the guidance file to only include relevant sections. The file is structured by category, making it easy to remove unused sections.

### Adding Project-Specific Workflows

Append custom workflow guides specific to your project:

```markdown
## Project Workflows

### Deploy Feature Branch
1. Use `create_update_set` with name "FEAT-XXXX Description"
2. Make changes...
3. Use `inspect_update_set` to review
4. Use `clone_update_set` to create backup
```

### Keeping Updated

When the MCP server is upgraded with new tools, re-copy the guidance files from the latest package:

```bash
# After upgrading
npm update -g @sonisoft/now-sdk-ext-mcp

# Re-copy guidance files
cp node_modules/@sonisoft/now-sdk-ext-mcp/docs/ai-agents/CLAUDE.md ./CLAUDE.md
```

## How It Works

Without these guidance files, an AI agent only sees:
1. Individual MCP tool names, parameters, and one-line descriptions
2. No understanding of how tools relate to each other
3. No knowledge of ServiceNow platform concepts (encoded queries, GlideSystem API, scopes)

With these files, the agent immediately knows:
- How to chain tools for multi-step workflows (query → investigate → modify → verify)
- ServiceNow platform concepts needed to construct correct parameters
- Safety patterns (dry-run for bulk ops, scope management, update set discipline)
- Decision guides mapping goals to the right tool
- Server-side scripting patterns for the `execute_script` tool
- Encoded query syntax for filtering across all query tools

The result is an agent that can build on ServiceNow as effectively as an experienced platform developer.

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
   now-sdk auth --add https://dev12345.service-now.com --alias dev --type oauth
   now-sdk auth --add https://prod12345.service-now.com --alias prod --type oauth
   ```

3. **Node.js 26+** is available in the environment

For clients that cannot unlock the OS keyring, see [credential storage](../../CLAUDE.md#credential-storage) for importing credentials and enabling `SN_CRED_STORE_ENABLE=1`.

## Table behavior and ATF planning

With MCP 4.8.0+, use `discover_table_behavior` alongside schema discovery when building or debugging table processes. Both behavior tools are in `full`, `readonly`, `developer`, and `flow_developer`; select one through `MCP_TOOL_PACKAGE` if your current package omits them.

Example arguments for `discover_table_behavior`:

```json
{
  "instance": "dev",
  "table": "change_request",
  "categories": ["business_rules", "flows", "state_models"],
  "details": ["scripts", "definitions", "dependencies"],
  "dependency_depth": 1,
  "max_bytes": 262144
}
```

Omit categories for all eight, including UI actions, client scripts, UI/data policies and workflows. Use `get_behavior_details` for 1–50 known references, preserving `kind`, `sourceTable` and `sysId` exactly as returned.

For Change Management ATFs, read required fields, state transitions, trigger conditions and dependent artifacts from `structuredContent`. Follow category cursors and inspect warnings, omitted details and remaining references. Keep browser requirements separate from server enforcement and preserve runtime/design provenance. Configuration does not establish that a condition will pass or a flow will run; verify execution separately.

See [README examples and output controls](../../README.md#table-behavior-discovery), [tool parameters](../../TOOLS.md#discover_table_behavior), and the [behavior guide](../table-behavior.md).

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

When the server gains tools, review current guidance in this repository and merge it into your project's existing instructions. Guidance files are not included in the npm package. From an updated repository checkout, copy them when creating a new project:

```bash
cp docs/ai-agents/CLAUDE.md /path/to/new-project/CLAUDE.md
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

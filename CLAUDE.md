# now-sdk-ext-mcp

MCP (Model Context Protocol) server that wraps `@sonisoft/now-sdk-ext-core` to enable AI systems (Claude, etc.) to interact directly with ServiceNow instances.

## Project Overview

This is a TypeScript MCP server built on `@modelcontextprotocol/sdk` (v1.x). It exposes ServiceNow operations as MCP tools that AI assistants can invoke — executing background scripts, querying data, running ATF tests, tailing logs, and more.

## Architecture

- **Framework**: `@modelcontextprotocol/sdk` v1.x (official MCP TypeScript SDK)
- **Core Library**: `@sonisoft/now-sdk-ext-core` v2.0.0-alpha.4 — provides all ServiceNow communication (auth, HTTP, WebSocket, script execution, ATF, syslog, etc.)
- **Transport**: stdio (standard for local MCP servers used by Claude Desktop, VS Code, Cursor, etc.)
- **Auth**: Instance resolution follows a fallback chain: tool `instance` parameter → `SN_AUTH_ALIAS` env var. If the user says "on my dev224436 instance", the AI passes `instance: "dev224436"`. If no instance is mentioned, the env var is used. The connection manager in `src/common/connection.ts` resolves the alias to credentials via `@servicenow/sdk-cli`'s credential store and caches instances per alias.

## Directory Structure

```
src/
├── index.ts                 # Server entry point — creates McpServer, registers tools, starts stdio transport
├── tools/                   # MCP tool implementations (one file per tool or logical group)
│   └── execute-script.ts    # execute_script tool — runs JS via Scripts - Background
└── common/
    └── connection.ts        # ServiceNow connection manager — lazy-init ServiceNowInstance
dist/                        # Compiled JS output (gitignored)
```

## Sibling Projects

- **Core library**: `/Users/cnanda/git/now-sdk-ext/now-sdk-ext-core` (`@sonisoft/now-sdk-ext-core`)
- **CLI**: `/Users/cnanda/git/now-sdk-ext/now-sdk-ext-cli` (`@sonisoft/now-sdk-ext-cli`)

The CLI is the reference implementation for how to use the core library. When adding new MCP tools, look at the corresponding CLI command in `now-sdk-ext-cli/src/commands/` for the usage pattern.

## Key Patterns

- All ServiceNow HTTP communication goes through `ServiceNowRequest` from the core library, which handles auth, CSRF tokens, cookies, and session management automatically.
- `BackgroundScriptExecutor` posts to `/sys.scripts.do` with a CSRF token, parses the XML response, and returns structured `BackgroundScriptExecutionResult`.
- Authentication uses `getCredentials()` from `@servicenow/sdk-cli` which reads from the ServiceNow CLI's stored credential system (same credentials used by `nex` CLI).
- The MCP server MUST NOT use `console.log()` — stdout is reserved for JSON-RPC. Use `console.error()` for debug output, or use the MCP logging context (`ctx.mcpReq.log()`).

## Build & Run

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Build + run (for local testing)
node dist/index.js     # Run the compiled server directly
```

## Adding New Tools

1. Create a new file in `src/tools/` (or add to an existing one if logically related).
2. Export a function that takes the `McpServer` instance and calls `server.registerTool()`.
3. Import and call that function from `src/index.ts`.
4. Use Zod schemas for input validation (the SDK handles this automatically).
5. Return `{ content: [{ type: "text", text: "..." }] }` from tool handlers.
6. Reference the corresponding CLI command for the expected behavior and data flow.

## Tool Parameter Convention

Every tool that interacts with a ServiceNow instance should include an optional `instance` parameter (the auth alias). Resolution order: tool parameter → `SN_AUTH_ALIAS` env var. This means:
- If the user says "on my dev224436 instance", the AI passes `instance: "dev224436"`.
- If no instance is mentioned and `SN_AUTH_ALIAS` is set, it's used as the default.
- If neither is available, the tool returns a clear error asking the user to specify one.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SN_AUTH_ALIAS` | _(none)_ | Default auth alias used when the tool's `instance` parameter is omitted |

## Conventions

- ES Modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Target ES2022, module Node16
- Match the patterns and style of the sibling `now-sdk-ext-core` and `now-sdk-ext-cli` projects

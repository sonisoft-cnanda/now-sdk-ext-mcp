# now-sdk-ext-mcp

MCP (Model Context Protocol) server that wraps `@sonisoft/now-sdk-ext-core` to enable AI systems (Claude, etc.) to interact directly with ServiceNow instances.

## Project Overview

This is a TypeScript MCP server built on `@modelcontextprotocol/sdk` (v1.x). It exposes ServiceNow operations as MCP tools that AI assistants can invoke — executing background scripts, querying data, running ATF tests, tailing logs, and more.

## Architecture

- **Framework**: `@modelcontextprotocol/sdk` v1.x (official MCP TypeScript SDK)
- **Core Library**: `@sonisoft/now-sdk-ext-core` v5.0.1 — provides all ServiceNow communication (auth, HTTP, WebSocket, script execution, ATF, syslog, etc.)
- **Transport**: stdio (standard for local MCP servers used by Claude Desktop, VS Code, Cursor, etc.)
- **Auth**: Instance resolution follows a fallback chain: tool `instance` parameter → `SN_AUTH_ALIAS` env var. If the user says "on my myinstance instance", the AI passes `instance: "myinstance"`. If no instance is mentioned, the env var is used. The connection manager in `src/common/connection.ts` resolves the alias to credentials via `@servicenow/sdk-cli`'s credential store and caches instances per alias.

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

- **Core library**: `../nowsdk-ext-core` (`@sonisoft/now-sdk-ext-core`)
- **CLI**: `../nowsdk-ext-cli` (`@sonisoft/now-sdk-ext-cli`)

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
- If the user says "on my myinstance instance", the AI passes `instance: "myinstance"`.
- If no instance is mentioned and `SN_AUTH_ALIAS` is set, it's used as the default.
- If neither is available, the tool returns a clear error asking the user to specify one.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SN_AUTH_ALIAS` | _(none)_ | Default auth alias used when the tool's `instance` parameter is omitted |
| `SN_CRED_STORE_ENABLE` | _(unset)_ | Opt in to `@sonisoft/sn-credstore` instead of the OS keyring |
| `SN_CRED_STORE_DISABLE` | _(unset)_ | Hard off switch; wins over `SN_CRED_STORE_ENABLE` |
| `SN_CRED_STORE` | `systemd-creds` | Credential store backend: `systemd-creds`, `file`, or `auto` |
| `SN_CRED_STORE_PATH` | _(XDG state dir)_ | Override the credential store location |
| `SN_CRED_STORE_DEBUG` | _(unset)_ | Verbose credential-store diagnostics on stderr |

## Credential Storage

An MCP server is always launched as a non-interactive child process, which cannot
unlock the OS keyring that `now-sdk` stores credentials in — and the failure is
silent, because `KeyChain.getPassword()` swallows the error and returns `null`.
Every tool call then reports "no credentials" regardless of what is stored.

`src/common/credstore-boot.ts` is imported first by `src/index.ts`. It does
nothing unless `SN_CRED_STORE_ENABLE=1` is set in the server's `env` block, in
which case it redirects the SDK's credential storage to `@sonisoft/sn-credstore`,
a headless-safe store several concurrent processes can share. Opting in is the
usual choice for this server; the default stays on the keyring so behaviour is
unchanged for anyone who has not asked.

The boot module writes only to **stderr** — stdout is the JSON-RPC transport, and
a non-protocol byte there breaks the client's parser.

## Conventions

- ES Modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Target ES2022, module Node16
- Match the patterns and style of the sibling `now-sdk-ext-core` and `now-sdk-ext-cli` projects

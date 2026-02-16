# now-sdk-ext-mcp

An MCP (Model Context Protocol) server that enables AI assistants to interact directly with ServiceNow instances — executing background scripts, querying data, running ATF tests, tailing logs, and more.

Built on [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) and [`@sonisoft/now-sdk-ext-core`](https://git.sonisoft.io).

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **ServiceNow CLI credentials** configured via `snc configure`

### Install and Build

```bash
git clone <repo-url>
cd now-sdk-ext-mcp
npm install
npm run build
```

### Configure Credentials

This server uses the same credential store as the ServiceNow CLI (`snc`). If you haven't already, configure your instance credentials:

```bash
now-sdk auth --add <instance_alias>
```

This stores credentials locally so the MCP server can authenticate without prompting.

### Run the Server

```bash
node dist/index.js
```

The server communicates over **stdio** (standard input/output) using the MCP JSON-RPC protocol. It is not meant to be run interactively — it's designed to be launched by an MCP client (Claude Desktop, VS Code, Cursor, etc.).

## Connecting to an MCP Client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"]
    }
  }
}
```

To set a default instance (so you don't have to specify it every time):

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "env": {
        "SN_AUTH_ALIAS": "dev224436"
      }
    }
  }
}
```

### VS Code / Cursor

Add to your `.vscode/mcp.json` or Cursor MCP settings:

```json
{
  "servers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "env": {
        "SN_AUTH_ALIAS": "dev224436"
      }
    }
  }
}
```

### Claude Code

Add to your `.claude/settings.json` or project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "env": {
        "SN_AUTH_ALIAS": "dev224436"
      }
    }
  }
}
```

## How It Works

Once connected, you can talk to your AI assistant naturally:

> "Find all CMDB CI records in the computer class on my dev224436 instance"

> "Run a script on dev224436 that counts all active incidents by priority"

> "Query the sys_user table for users with the admin role on prod"

The AI will:
1. Write the appropriate ServiceNow server-side JavaScript
2. Call the `execute_script` tool with the instance alias and script
3. Return the results in a readable format

The `instance` parameter can be passed explicitly per-request or defaulted via the `SN_AUTH_ALIAS` environment variable, so if you only work with one instance you can set-and-forget.

## Available Tools

See **[TOOLS.md](TOOLS.md)** for the full list of available tools with parameters and examples.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SN_AUTH_ALIAS` | _(none)_ | Default ServiceNow auth alias. Used when a tool call doesn't specify an `instance` parameter. |

## Development

### Project Structure

```
src/
├── index.ts                 # Server entry point — registers tools, starts stdio transport
├── tools/                   # MCP tool implementations (one file per tool)
│   └── execute-script.ts    # execute_script tool
└── common/
    └── connection.ts        # ServiceNow connection manager (credential resolution + caching)

test/
├── __mocks__/               # Manual mocks for external dependencies
├── helpers/                 # Shared test utilities and factories
├── unit/                    # Unit tests (mocked external deps)
│   ├── common/
│   └── tools/
└── integration/             # Integration tests (full MCP protocol, no real SN calls)
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Clean and compile TypeScript to `dist/` |
| `npm run dev` | Build and run the server |
| `npm test` | Run unit tests |
| `npm run test:unit` | Run unit tests with coverage and junit reporting |
| `npm run test:integration` | Run MCP protocol integration tests |
| `npm run test:all` | Run all tests |
| `npm run lint` | Type-check with `tsc --noEmit` |

### Adding a New Tool

1. Create a new file in `src/tools/` (e.g., `src/tools/query-table.ts`).
2. Export a registration function:

   ```typescript
   import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
   import { z } from "zod";
   import { getServiceNowInstance } from "../common/connection.js";

   export function registerQueryTableTool(server: McpServer): void {
     server.registerTool(
       "query_table",
       {
         title: "Query Table",
         description: "Query records from a ServiceNow table.",
         inputSchema: {
           instance: z.string().optional().describe("ServiceNow instance auth alias"),
           table: z.string().describe("Table name to query"),
           // ... more params
         },
       },
       async ({ instance, table }) => {
         const snInstance = await getServiceNowInstance(instance);
         // ... use core library to query
         return {
           content: [{ type: "text" as const, text: "results here" }],
         };
       }
     );
   }
   ```

3. Register it in `src/index.ts`:

   ```typescript
   import { registerQueryTableTool } from "./tools/query-table.js";

   registerQueryTableTool(server);
   ```

4. Add tests in `test/unit/tools/` following the existing pattern.
5. Document the tool in [`TOOLS.md`](TOOLS.md).

### Testing Approach

Tests use the MCP SDK's `InMemoryTransport` to create linked client+server pairs entirely in-process. This means tests go through the full MCP protocol stack (JSON-RPC serialization, schema validation, handler dispatch) without spawning processes or touching the network.

- **Unit tests** (`test/unit/`): Mock external dependencies (`@sonisoft/now-sdk-ext-core`, `@servicenow/sdk-cli`) using `jest.unstable_mockModule()` for ESM compatibility. Test tool behavior through the MCP client.
- **Integration tests** (`test/integration/`): Verify the MCP protocol lifecycle (handshake, tool listing, sequential calls) without mocking.

### Sibling Projects

This MCP server wraps the same core library used by the CLI:

- **Core library**: [`@sonisoft/now-sdk-ext-core`](../now-sdk-ext-core) — all ServiceNow communication (auth, HTTP, WebSocket, script execution, ATF, syslog)
- **CLI**: [`@sonisoft/now-sdk-ext-cli`](../now-sdk-ext-cli) — the `nex` CLI that wraps the core library with oclif

When adding new MCP tools, reference the corresponding CLI command in `now-sdk-ext-cli/src/commands/` for the expected behavior and data flow.

## Contributing

### Testing

There are three layers of testing for this project:

#### 1. Automated Tests (Jest)

Unit and integration tests run entirely in-process using the MCP SDK's `InMemoryTransport` — no server process, no network, no credentials needed.

```bash
npm test                 # Unit tests (default, fast)
npm run test:unit        # Unit tests with coverage + junit
npm run test:integration # MCP protocol integration tests
npm run test:all         # Everything
```

Unit tests mock all external dependencies (`@sonisoft/now-sdk-ext-core`, `@servicenow/sdk-cli`) so they are fast and deterministic. Integration tests verify the MCP protocol lifecycle (handshake, tool listing, tool calls, error responses) without hitting real ServiceNow instances.

Always run `npm test` before committing.

#### 2. MCP Inspector (Interactive Testing)

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a web UI that acts as an MCP client, letting you interactively browse tools, invoke them with custom inputs, and see results — without connecting to Claude or any AI client.

```bash
# Build first
npm run build

# Launch the inspector (opens a browser UI at http://localhost:6274)
npx @modelcontextprotocol/inspector node dist/index.js

# Pass env vars to the server (e.g., default instance alias)
npx @modelcontextprotocol/inspector -e SN_AUTH_ALIAS=dev224436 node dist/index.js
```

In the inspector UI you can:
- Browse registered tools and their input schemas in the **Tools** tab
- Fill in parameters and invoke tools
- See the JSON-RPC request/response and tool output
- View server stderr logs in the **Notifications** pane

The inspector also has a headless CLI mode for scripting:

```bash
# List all tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Call a specific tool
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name execute_script \
  --tool-arg instance=dev224436 \
  --tool-arg script='gs.print("hello")' \
  --tool-arg scope=global
```

#### 3. Testing with Claude Code

To test the server end-to-end with Claude Code as the MCP client:

**Add the server:**

```bash
# From the now-sdk-ext-mcp project root (after building):
claude mcp add --transport stdio --env SN_AUTH_ALIAS=dev224436 servicenow \
  -- node /absolute/path/to/now-sdk-ext-mcp/dist/index.js
```

Or create a `.mcp.json` at your project root (this is shareable via version control):

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "env": {
        "SN_AUTH_ALIAS": "dev224436"
      }
    }
  }
}
```

**Verify the connection:**

Inside a Claude Code session, run `/mcp` to see all connected servers and their status. The `servicenow` server should show as connected.

**Test it:**

Ask Claude something like:

> "Run a script on dev224436 that prints the current user's name using gs.print(gs.getUserName())"

Claude should call the `execute_script` tool and return the result.

**Manage servers:**

```bash
claude mcp list              # List all configured servers
claude mcp get servicenow    # Show details for the servicenow server
claude mcp remove servicenow # Remove it
```

#### Manual stdin Testing

Since the server communicates via JSON-RPC over stdio, you can pipe messages directly for quick smoke tests:

```bash
# List tools (single-message shortcut — works for basic inspection)
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | node dist/index.js 2>/dev/null \
  | jq '.result.tools[].name'
```

For a full protocol exchange (initialize handshake + tool call):

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":0}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  | node dist/index.js 2>/dev/null \
  | jq
```

### Debugging

Since stdout is reserved for JSON-RPC, **never use `console.log()` in server code** — it corrupts the protocol stream. Use these approaches instead:

- **`console.error()`** — writes to stderr, which is safe and visible in the MCP Inspector's Notifications pane and in Claude Desktop's log files (`~/Library/Logs/Claude/mcp*.log`).
- **MCP Inspector** — run the server under the inspector to see all JSON-RPC messages and stderr output in real time.
- **File logging** — for persistent debug logs, the core library's `Logger` class writes to `logs/` with Winston. Set the log level via the tool's logic as needed.

### Code Conventions

- ES Modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Target ES2022, module Node16
- Match the patterns and style of the sibling `now-sdk-ext-core` and `now-sdk-ext-cli` projects
- Every tool that talks to ServiceNow should accept an optional `instance` parameter
- Test every tool through the MCP client (not by calling handler functions directly) so the full protocol stack is exercised

## License

MIT

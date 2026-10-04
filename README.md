# now-sdk-ext-mcp

An MCP (Model Context Protocol) server that enables AI assistants to interact directly with ServiceNow instances — executing background scripts, querying data, running ATF tests, tailing logs, and more.

Built on [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) and [`@sonisoft/now-sdk-ext-core`](https://github.com/sonisoft-cnanda/now-sdk-ext-core).

Use [table behavior discovery](#table-behavior-discovery) to inspect automation, field requirements, and related artifact details. Available in MCP **4.8.0**, using core **6.4.1**.

## Quick Start

### Prerequisites

- **Node.js** >= 26
- **ServiceNow CLI credentials** configured via `now-sdk auth --add`

### Use the Published Package

Configure your MCP client to launch `npx --yes @sonisoft/now-sdk-ext-mcp`:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "npx",
      "args": ["--yes", "@sonisoft/now-sdk-ext-mcp"],
      "env": {
        "SN_AUTH_ALIAS": "dev",
        "MCP_TOOL_PACKAGE": "readonly"
      }
    }
  }
}
```

The `readonly` package includes schema and behavior discovery. Omit `MCP_TOOL_PACKAGE` for all tools, or select a [tool package](TOOLS.md#tool-packages) for your workflow.

### Build from Source

```bash
git clone https://github.com/sonisoft-cnanda/now-sdk-ext-mcp.git
cd now-sdk-ext-mcp
npm install
npm run build
```

### Configure Credentials

This server uses the same credential store as the ServiceNow CLI. If you haven't already, configure your instance credentials:

```bash
npm install -g @servicenow/sdk
now-sdk auth --add https://dev12345.service-now.com --alias dev --type oauth
```

This stores credentials locally. For clients that cannot unlock the OS keyring, import credentials into `@sonisoft/sn-credstore` and set `SN_CRED_STORE_ENABLE=1` in the server environment; see [credential storage](CLAUDE.md#credential-storage).

> **Breaking Change in v2.0.0 (ServiceNow SDK 4.3.0)**
>
> v2.0.0 upgrades the underlying ServiceNow SDK from 4.2.x to 4.3.0, which **changed how credential aliases are stored** (replacing the previous `keytar`-based credential store with a new implementation).
>
> If you are upgrading from v1.x:
> - Credential aliases created with ServiceNow SDK 4.2.x **cannot be read** by SDK 4.3.x
> - You **must re-create all instance aliases** after upgrading
>
> ```bash
> # 1. Update the global CLI
> npm install -g @servicenow/sdk@4.3.0
>
> # 2. Re-add each instance alias
> now-sdk auth --add https://dev12345.service-now.com --alias dev --type oauth
>
> # 3. Verify your aliases work
> now-sdk auth --list
> ```

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
        "SN_AUTH_ALIAS": "myinstance"
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
        "SN_AUTH_ALIAS": "myinstance"
      }
    }
  }
}
```

### Claude Code

Add to your project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "node",
      "args": ["/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "env": {
        "SN_AUTH_ALIAS": "myinstance"
      }
    }
  }
}
```

### Opencode

Add to your `.config/opencode/opencode.json` or project-level `opencode.jsonc`

```json
{
  "mcp": {
    "servicenow": {
      "type": "local",
      "command": ["node", "/absolute/path/to/now-sdk-ext-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "SN_AUTH_ALIAS": "myinstance"
      }
    }
  }
}
```

## How It Works

Once connected, you can talk to your AI assistant naturally:

> "Find all CMDB CI records in the computer class on my myinstance instance"

> "Run a script on myinstance that counts all active incidents by priority"

> "Query the sys_user table for users with the admin role on prod"

> "Inspect change_request behavior on dev. Identify transition requirements and flow conditions needed for Change Management ATF coverage."

The assistant selects the appropriate tools, supplies the instance alias, and interprets their results. Schema tools describe fields; behavior tools retrieve automation configuration and dependencies. Script execution is available when the task calls for server-side JavaScript.

The `instance` parameter can be passed explicitly per-request or defaulted via the `SN_AUTH_ALIAS` environment variable, so if you only work with one instance you can set-and-forget.

## Table Behavior Discovery

Use `discover_table_behavior` to inventory configuration affecting a table and `get_behavior_details` to retrieve known artifacts without rescanning. Both tools are read-only and available in the `full`, `readonly`, `developer`, and `flow_developer` packages.

| Category | Functional context |
| --- | --- |
| `business_rules` | Before/after/async timing, operation flags, order, conditions and scripts |
| `ui_actions` | Form/list/workspace placement, roles, conditions and scripts |
| `client_scripts` | Client events, target fields, views and inherited applicability |
| `ui_policies` | Conditions and mandatory, visible or read-only field actions |
| `data_policies` | Server field requirements and enforcement settings |
| `workflows` | Legacy workflow versions, start conditions, activities and transitions |
| `flows` | Record triggers, conditions and optional current flow definitions |
| `state_models` | State fields, transition gates and required fields in supported generic layouts |

Pass these **tool arguments** to `discover_table_behavior` for a compact inventory:

```json
{
  "instance": "dev",
  "table": "change_request"
}
```

Defaults: active configuration, applicable ancestors, all eight categories, 50 items per category and a 65,536-byte JSON budget. Summaries include conditions and declarative field actions. Request scripts, definitions and dependencies in the first call when needed:

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

For known artifacts, pass 1–50 `references` to `get_behavior_details`. Replace example IDs with real source IDs. Reference objects preserve the core API's camelCase keys even though tool options use snake_case:

```json
{
  "instance": "dev",
  "references": [
    {
      "kind": "flows",
      "sourceTable": "sys_hub_flow",
      "sysId": "0123456789abcdef0123456789abcdef"
    }
  ],
  "details": ["definitions", "dependencies"],
  "dependency_depth": 1,
  "max_bytes": 262144
}
```

References from discovery can be passed through unchanged. Flow discovery can return trigger references; a known flow ID uses `kind: "flows"` and `sourceTable: "sys_hub_flow"`. Detail retrieval also supports subflows, actions, Script Includes and decision tables.

**Controls and continuation:**

- Filter discovery with `categories`, metadata `name`, or up to 50 `sys_ids`. Use `include_inherited: false` for direct table associations and `include_inactive: true` for inactive/draft candidates where available.
- `limit` accepts 1–200 items per category. `max_bytes` accepts 4,096–1,048,576 bytes on either tool.
- `dependency_depth` defaults to 0; 1 requires `details` containing `dependencies` and expands at most 50 unique dependency references. `scope` selects the transaction scope for flow definition reads.
- Pass each category's `nextCursor` in `cursors`, retaining the original table, filters and detail selection. For example, after a `business_rules`-only inventory:

```json
{
  "instance": "dev",
  "table": "change_request",
  "categories": ["business_rules"],
  "cursors": {
    "business_rules": "<nextCursor from the previous response>"
  }
}
```

Both tools return the core result in `structuredContent` and a short text summary. Discovery includes category `status` (`complete`, `partial`, `unavailable`, or `failed`), `items`, `warnings` and optional `nextCursor`. Detail batches include `remainingReferences`. Oversized details are omitted whole with `omittedDetails` and warnings; increase the budget or narrow the batch. Empty pages can still need continuation, and empty results only describe the account's accessible configuration.

**Change Management ATF workflow:** combine schema fields and choices with behavior conditions, required fields, state transitions, approval steps and dependent artifacts. Keep UI behavior separate from server enforcement. Preserve source references and runtime/design provenance: current flow definitions can differ from the version associated with runtime trigger metadata. Conditions are not evaluated and execution order is not predicted. Validate the resulting test assumptions with ATF results, logs and flow contexts.

Live behavior validation used an Australia instance; Zurich validation remains outstanding. See the [behavior guide](docs/table-behavior.md), [tool parameters](TOOLS.md#discover_table_behavior), and [core API reference](https://github.com/sonisoft-cnanda/now-sdk-ext-core/blob/main/docs/TableBehaviorDiscovery.md).

## Available Tools

See **[TOOLS.md](TOOLS.md)** for the full list of available tools with parameters and examples.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SN_AUTH_ALIAS` | _(none)_ | Default ServiceNow auth alias. Used when a tool call doesn't specify an `instance` parameter. |
| `MCP_TOOL_PACKAGE` | `full` | Tool package or comma-separated union; see [tool packages](TOOLS.md#tool-packages). |
| `SN_CRED_STORE_ENABLE` | _(unset)_ | Set to `1` to use the imported headless credential store; see [credential storage](CLAUDE.md#credential-storage). |
| `NEX_LOG_LEVEL` | `info` | Diagnostic log level; logs go to stderr. See [debugging](#debugging) for file logging. |

## Development

### Project Structure

```
src/
├── index.ts                 # Server entry point — registers tools, starts stdio transport
├── tools/                   # Tool implementations and registry.ts
│   └── behavior.ts          # Discovery and batched behavior detail tools
├── config/tool-packages.ts  # Role package definitions
├── resources/              # Read-only servicenow:// resources
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

1. Add a registration function under `src/tools/`; [behavior.ts](src/tools/behavior.ts) demonstrates input validation, structured output and error handling.
2. Route ServiceNow calls through `withConnectionRetry` and delegate reusable behavior to core.
3. Add the tool to `TOOL_REGISTRY` in [registry.ts](src/tools/registry.ts) and classify its effects in [annotations.ts](src/common/annotations.ts). Registration rejects unclassified tools.
4. Add it to relevant role packages in [tool-packages.ts](src/config/tool-packages.ts). The full package uses the registry; the readonly package uses annotations.
5. Test listing and invocation through the MCP client in `test/unit/tools/`, and cover package membership where relevant.
6. Document parameters and examples in [TOOLS.md](TOOLS.md) and update user-facing README guidance.

### Testing Approach

Tool tests use the MCP SDK's `InMemoryTransport` for linked client/server pairs and exercise JSON-RPC, schema validation and handler dispatch without ServiceNow calls. Logging tests also spawn the real server to verify stdout purity, stderr redaction and shutdown flushing.

- **Unit tests** (`test/unit/`): Mock external dependencies (`@sonisoft/now-sdk-ext-core`, `@servicenow/sdk-cli`) using `jest.unstable_mockModule()` for ESM compatibility. Test tool behavior through the MCP client.
- **Integration tests** (`test/integration/`): Verify the MCP protocol lifecycle (handshake, tool listing, sequential calls) without mocking.

### Sibling Projects

This MCP server wraps the same core library used by the CLI:

- **Core library**: [`@sonisoft/now-sdk-ext-core`](https://github.com/sonisoft-cnanda/now-sdk-ext-core) — all ServiceNow communication (auth, HTTP, WebSocket, script execution, ATF, syslog)
- **CLI**: [`@sonisoft/now-sdk-ext-cli`](https://github.com/sonisoft-cnanda/now-sdk-ext-cli) — the `nex` CLI that wraps the core library with oclif

When adding new MCP tools, reference the corresponding CLI command in `now-sdk-ext-cli/src/commands/` for the expected behavior and data flow.

## Restricting what can be changed

Instance changes are **permitted by default**. Set `NEX_POLICY_DENY` in the server's
environment to refuse them:

```json
{
  "mcpServers": {
    "now-sdk-ext": {
      "command": "now-sdk-ext-mcp",
      "env": { "NEX_POLICY_DENY": "all" }
    }
  }
}
```

Refused tools return an error result explaining that nothing was changed; read-only
tools are unaffected. There is deliberately **no tool parameter** to grant permission —
on this surface the caller is the model, so a parameter it can set would not be a
control.

> `NEX_POLICY_DENY` only holds when set somewhere the model cannot write. The config
> file above usually lives **in the workspace**, and an agent with file-write access can
> edit it. For a real lockdown set it in the environment that launches the client — a
> shell profile, a systemd unit, or a container env.
>
> This is a guardrail, not a security boundary. Anything holding the credential can
> reach the instance directly.

## Contributing

### Testing

There are three layers of testing for this project:

#### 1. Automated Tests (Jest)

Protocol tests use `InMemoryTransport`; logging checks also launch the real server. Automated tests do not require ServiceNow credentials or call a live instance.

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
npx @modelcontextprotocol/inspector -e SN_AUTH_ALIAS=myinstance node dist/index.js
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
  --tool-arg instance=myinstance \
  --tool-arg script='gs.print("hello")' \
  --tool-arg scope=global
```

#### 3. Testing with Claude Code

To test the server end-to-end with Claude Code as the MCP client:

**Add the server:**

```bash
# From the now-sdk-ext-mcp project root (after building):
claude mcp add --transport stdio --env SN_AUTH_ALIAS=myinstance servicenow \
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
        "SN_AUTH_ALIAS": "myinstance"
      }
    }
  }
}
```

**Verify the connection:**

Inside a Claude Code session, run `/mcp` to see all connected servers and their status. The `servicenow` server should show as connected.

**Test it:**

Ask Claude something like:

> "Run a script on myinstance that prints the current user's name using gs.print(gs.getUserName())"

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

- **Shared logger** — use `getLogger()` from `src/common/logging.ts`. It sends diagnostics to stderr and redacts structured metadata and recognized credential patterns. Avoid raw `console.error()` with errors or session data.
- **MCP Inspector** — run the server under the inspector to see all JSON-RPC messages and stderr output in real time.
- **File logging** — off by default. This server's working directory is chosen by whoever launched it, so it writes no files unless asked. Configure with environment variables:

  | Variable | Effect |
  | --- | --- |
  | `NEX_LOG_FILE` | `1`/`true` writes a log file to `$XDG_STATE_HOME/now-sdk-ext/logs` (`~/.local/state/...`) |
  | `NEX_LOG_DIR` | Write log files to this directory instead. Implies `NEX_LOG_FILE` |
  | `NEX_LOG_LEVEL` | `error`, `warn`, `info` (default), `http`, `verbose`, `debug`, `silly` |
  | `NEX_POLICY_DENY` | `write`, `execute`, or `all` — refuses matching instance changes. Malformed values **fail closed** |
  | `NEX_POLICY_ALLOW` | Grants verbs. Inert while changes are permitted by default |

  Diagnostics always go to **stderr**, never stdout — stdout carries JSON-RPC. SDK diagnostics use the same redacting logger. Redaction covers structured credential fields and recognized message patterns; never interpolate arbitrary secrets into log messages. SIGINT and SIGTERM wait for log flushing within a two-second shutdown bound. Core 6.4.1 also waits for the underlying file stream to finish pending writes.

### Code Conventions

- ES Modules (`"type": "module"` in package.json)
- TypeScript strict mode
- Target ES2022, module Node16
- Match the patterns and style of the sibling `now-sdk-ext-core` and `now-sdk-ext-cli` projects
- Every tool that talks to ServiceNow should accept an optional `instance` parameter
- Test every tool through the MCP client (not by calling handler functions directly) so the full protocol stack is exercised

## ServiceNow SDK upgrades

New `@servicenow/sdk` releases are rolled through sn-credstore, core, the CLI and the MCP
server by a scheduled routine. Its runbook and scripts (`scripts/sdk-watch/`) are described in
[docs/SDK_UPGRADE_ROUTINE.md](docs/SDK_UPGRADE_ROUTINE.md).

## License

MIT

## OAuth renewal

Alias-bound connections provide core with a credential resolver. Core can refresh
OAuth and rebuild session cookies during long-running operations; the 30-minute
connection cache is not an authentication lifetime.

Core owns authentication retries. MCP does not retry `NEX_AUTH_*` or
`NEX_SESSION_*` errors again. Writes and stateful sessions require an explicit safe
restart after expiry. Rejected refresh credentials require a new login; temporary
store/network failures do not establish that interactive reauthentication is needed.

When upgrading a shared store, stop all clients first, upgrade every client
(including standalone `now-sdk-x`) to sn-credstore 1.1.1 or later, then restart.
The new lock protocol cannot safely run alongside older clients.

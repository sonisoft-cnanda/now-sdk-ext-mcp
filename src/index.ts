#!/usr/bin/env node

// FIRST, deliberately: redirect SDK credential storage off the OS keyring before
// anything can read credentials. An MCP server is always launched as a
// non-interactive child process, where the keyring cannot be unlocked.
import "./common/credstore-boot.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerServiceNowResources } from "./resources/servicenow.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { registerListToolPackagesTool } from "./tools/tool-packages.js";
import { resolveToolPackage, reportResolution } from "./common/tool-packages.js";
import { readServerVersion } from "./common/version.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer(
  {
    name: "now-sdk-ext-mcp",
    version: readServerVersion(),
  },
  {
    // Declared explicitly rather than inferred from what happens to get registered.
    //
    // Note progress is NOT a capability — it is base protocol, driven entirely by
    // the client putting a progressToken in a request's _meta. So there is nothing
    // to advertise for it; the server just has to honour the token when it is sent.
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

registerServiceNowResources(server);

// Tools are registered through the registry rather than 86 direct calls, so a
// package can select a subset. Resolution happens once, before registration —
// filtering after the fact would still pay the import cost and still advertise
// the tools in tools/list.
const activePackage = resolveToolPackage(process.env.MCP_TOOL_PACKAGE);
reportResolution(activePackage);

for (const name of activePackage.tools) {
  TOOL_REGISTRY[name](server);
}

// Always registered, whatever the package. A filtered session otherwise has no
// way to tell "this server cannot do that" from "that tool is filtered out of
// this session".
registerListToolPackagesTool(server, activePackage);


// Prevent the process from crashing silently on unexpected errors.
// Log to stderr (stdout is reserved for JSON-RPC).
process.on("uncaughtException", (error) => {
  console.error("[now-sdk-ext-mcp] Uncaught exception:", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[now-sdk-ext-mcp] Unhandled rejection:", reason);
});

// Start the server on stdio transport
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("now-sdk-ext-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

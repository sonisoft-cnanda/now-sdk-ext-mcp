#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerExecuteScriptTool } from "./tools/execute-script.js";
import {
  registerRunAtfTestTool,
  registerRunAtfTestSuiteTool,
} from "./tools/atf.js";
import { registerQueryTableTool } from "./tools/query-table.js";
import { registerFindAtfTestsTool } from "./tools/find-atf-tests.js";
import { registerQuerySyslogTool } from "./tools/query-syslog.js";
import { registerLookupAppTool } from "./tools/lookup-app.js";
import { registerLookupTableTool } from "./tools/lookup-table.js";
import { registerLookupColumnsTool } from "./tools/lookup-columns.js";
import {
  registerCodeSearchTool,
  registerListCodeSearchGroupsTool,
  registerListCodeSearchTablesTool,
  registerAddCodeSearchTableTool,
} from "./tools/codesearch.js";

const server = new McpServer({
  name: "now-sdk-ext-mcp",
  version: "1.0.0-alpha.0",
});

// Register tools
registerExecuteScriptTool(server);
registerRunAtfTestTool(server);
registerRunAtfTestSuiteTool(server);
registerQueryTableTool(server);
registerFindAtfTestsTool(server);
registerQuerySyslogTool(server);
registerLookupAppTool(server);
registerLookupTableTool(server);
registerLookupColumnsTool(server);
registerCodeSearchTool(server);
registerListCodeSearchGroupsTool(server);
registerListCodeSearchTablesTool(server);
registerAddCodeSearchTableTool(server);

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

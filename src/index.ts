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
import {
  registerDiscoverTableSchemaTool,
  registerExplainFieldTool,
  registerValidateCatalogTool,
} from "./tools/schema.js";
import {
  registerGetCurrentScopeTool,
  registerSetCurrentScopeTool,
  registerListScopedAppsTool,
} from "./tools/scope.js";
import {
  registerGetCurrentUpdateSetTool,
  registerListUpdateSetsTool,
  registerCreateUpdateSetTool,
  registerSetCurrentUpdateSetTool,
  registerInspectUpdateSetTool,
} from "./tools/updateset.js";
import {
  registerAddTaskCommentTool,
  registerAssignTaskTool,
  registerResolveIncidentTool,
  registerCloseIncidentTool,
  registerApproveChangeTool,
  registerFindTaskTool,
} from "./tools/task.js";
import {
  registerBatchCreateRecordsTool,
  registerBatchUpdateRecordsTool,
} from "./tools/batch.js";
import {
  registerListAttachmentsTool,
  registerGetAttachmentInfoTool,
} from "./tools/attachment.js";
import {
  registerGetAppDetailsTool,
  registerValidateAppInstallTool,
  registerSearchStoreAppsTool,
  registerListCompanyAppsTool,
  registerInstallStoreAppTool,
  registerUpdateStoreAppTool,
  registerInstallFromAppRepoTool,
  registerPublishToAppRepoTool,
} from "./tools/app-manager.js";
import { registerCreateWorkflowTool } from "./tools/workflow.js";
import {
  registerPullScriptTool,
  registerPushScriptTool,
} from "./tools/scriptsync.js";

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
registerDiscoverTableSchemaTool(server);
registerExplainFieldTool(server);
registerValidateCatalogTool(server);
registerGetCurrentScopeTool(server);
registerSetCurrentScopeTool(server);
registerListScopedAppsTool(server);
registerGetCurrentUpdateSetTool(server);
registerListUpdateSetsTool(server);
registerCreateUpdateSetTool(server);
registerSetCurrentUpdateSetTool(server);
registerInspectUpdateSetTool(server);
registerAddTaskCommentTool(server);
registerAssignTaskTool(server);
registerResolveIncidentTool(server);
registerCloseIncidentTool(server);
registerApproveChangeTool(server);
registerFindTaskTool(server);
registerBatchCreateRecordsTool(server);
registerBatchUpdateRecordsTool(server);
registerListAttachmentsTool(server);
registerGetAttachmentInfoTool(server);
registerGetAppDetailsTool(server);
registerValidateAppInstallTool(server);
registerSearchStoreAppsTool(server);
registerListCompanyAppsTool(server);
registerInstallStoreAppTool(server);
registerUpdateStoreAppTool(server);
registerInstallFromAppRepoTool(server);
registerPublishToAppRepoTool(server);
registerCreateWorkflowTool(server);
registerPullScriptTool(server);
registerPushScriptTool(server);

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

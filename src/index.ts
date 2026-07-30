#!/usr/bin/env node

// FIRST, deliberately: redirect SDK credential storage off the OS keyring before
// anything can read credentials. An MCP server is always launched as a
// non-interactive child process, where the keyring cannot be unlocked.
import "./common/credstore-boot.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readServerVersion } from "./common/version.js";
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
  registerCloneUpdateSetTool,
  registerMoveUpdateSetRecordsTool,
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
  registerUploadAttachmentTool,
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
import {
  registerCountRecordsTool,
  registerAggregateQueryTool,
  registerAggregateGroupedTool,
} from "./tools/aggregate.js";
import { registerCheckInstanceHealthTool } from "./tools/health.js";
import {
  registerGetCmdbRelationshipsTool,
  registerTraverseCmdbGraphTool,
} from "./tools/cmdb.js";
import {
  registerListInstanceTablesTool,
  registerListPluginsTool,
} from "./tools/discovery.js";
import {
  registerQueryUpdateRecordsTool,
  registerQueryDeleteRecordsTool,
} from "./tools/query-batch.js";
import {
  registerExportRecordXmlTool,
  registerImportRecordsXmlTool,
} from "./tools/xml-record.js";
import {
  registerListKnowledgeBasesTool,
  registerGetKnowledgeBaseTool,
  registerListKbCategoriesTool,
  registerCreateKbCategoryTool,
  registerListKbArticlesTool,
  registerGetKbArticleTool,
  registerCreateKbArticleTool,
  registerUpdateKbArticleTool,
  registerPublishKbArticleTool,
} from "./tools/knowledge.js";
import {
  registerListCatalogItemsTool,
  registerGetCatalogItemTool,
  registerListCatalogCategoriesTool,
  registerGetCatalogCategoryTool,
  registerListCatalogItemVariablesTool,
  registerSubmitCatalogRequestTool,
} from "./tools/catalog.js";
import {
  registerExecuteFlowTool,
  registerExecuteSubflowTool,
  registerExecuteActionTool,
  registerGetFlowContextStatusTool,
  registerGetFlowOutputsTool,
  registerGetFlowErrorTool,
  registerCancelFlowTool,
  registerTestFlowTool,
  registerCopyFlowTool,
  registerGetFlowExecutionDetailsTool,
  registerGetFlowLogsTool,
} from "./tools/flow.js";

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
    },
  }
);

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
registerCountRecordsTool(server);
registerAggregateQueryTool(server);
registerAggregateGroupedTool(server);
registerCheckInstanceHealthTool(server);
registerGetCmdbRelationshipsTool(server);
registerTraverseCmdbGraphTool(server);
registerListInstanceTablesTool(server);
registerListPluginsTool(server);
registerQueryUpdateRecordsTool(server);
registerQueryDeleteRecordsTool(server);
registerCloneUpdateSetTool(server);
registerMoveUpdateSetRecordsTool(server);
registerUploadAttachmentTool(server);
registerExportRecordXmlTool(server);
registerImportRecordsXmlTool(server);
registerListKnowledgeBasesTool(server);
registerGetKnowledgeBaseTool(server);
registerListKbCategoriesTool(server);
registerCreateKbCategoryTool(server);
registerListKbArticlesTool(server);
registerGetKbArticleTool(server);
registerCreateKbArticleTool(server);
registerUpdateKbArticleTool(server);
registerPublishKbArticleTool(server);
registerListCatalogItemsTool(server);
registerGetCatalogItemTool(server);
registerListCatalogCategoriesTool(server);
registerGetCatalogCategoryTool(server);
registerListCatalogItemVariablesTool(server);
registerSubmitCatalogRequestTool(server);
registerExecuteFlowTool(server);
registerExecuteSubflowTool(server);
registerExecuteActionTool(server);
registerGetFlowContextStatusTool(server);
registerGetFlowOutputsTool(server);
registerGetFlowErrorTool(server);
registerCancelFlowTool(server);
registerTestFlowTool(server);
registerCopyFlowTool(server);
registerGetFlowExecutionDetailsTool(server);
registerGetFlowLogsTool(server);

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

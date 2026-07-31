/**
 * Tool name -> registration function.
 *
 * index.ts used to call all 86 registration functions directly, which meant the
 * only way to know which tools exist was to read 86 lines of imports. Nothing
 * could ask "which tools are there?" without registering them.
 *
 * This table makes the set addressable, so a package can name a subset and
 * something can register exactly that. It is the same shape as TOOL_ANNOTATIONS
 * in common/annotations.ts — deliberately, since they are keyed identically and
 * a test asserts they cover the same set. Two tables that must agree are worth
 * having only if something checks that they do.
 *
 * GENERATED-ISH: derived from src/tools/*.ts, but checked in and maintained by
 * hand. A new tool has to be added here or it cannot be registered at all —
 * which is the point, and is asserted by a test rather than left to memory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  registerAggregateGroupedTool,
  registerAggregateQueryTool,
  registerCountRecordsTool,
} from "../tools/aggregate.js";
import {
  registerGetAppDetailsTool,
  registerInstallFromAppRepoTool,
  registerInstallStoreAppTool,
  registerListCompanyAppsTool,
  registerPublishToAppRepoTool,
  registerSearchStoreAppsTool,
  registerUpdateStoreAppTool,
  registerValidateAppInstallTool,
} from "../tools/app-manager.js";
import {
  registerRunAtfTestSuiteTool,
  registerRunAtfTestTool,
} from "../tools/atf.js";
import {
  registerGetAttachmentInfoTool,
  registerListAttachmentsTool,
  registerUploadAttachmentTool,
} from "../tools/attachment.js";
import {
  registerBatchCreateRecordsTool,
  registerBatchUpdateRecordsTool,
} from "../tools/batch.js";
import {
  registerGetCatalogCategoryTool,
  registerGetCatalogItemTool,
  registerListCatalogCategoriesTool,
  registerListCatalogItemVariablesTool,
  registerListCatalogItemsTool,
  registerSubmitCatalogRequestTool,
} from "../tools/catalog.js";
import {
  registerGetCmdbRelationshipsTool,
  registerTraverseCmdbGraphTool,
} from "../tools/cmdb.js";
import {
  registerAddCodeSearchTableTool,
  registerCodeSearchTool,
  registerListCodeSearchGroupsTool,
  registerListCodeSearchTablesTool,
} from "../tools/codesearch.js";
import {
  registerListInstanceTablesTool,
  registerListPluginsTool,
} from "../tools/discovery.js";
import {
  registerExecuteScriptTool,
} from "../tools/execute-script.js";
import {
  registerFindAtfTestsTool,
} from "../tools/find-atf-tests.js";
import {
  registerCancelFlowTool,
  registerCopyFlowTool,
  registerExecuteActionTool,
  registerExecuteFlowTool,
  registerExecuteSubflowTool,
  registerGetFlowContextStatusTool,
  registerGetFlowErrorTool,
  registerGetFlowExecutionDetailsTool,
  registerGetFlowLogsTool,
  registerGetFlowOutputsTool,
  registerTestFlowTool,
} from "../tools/flow.js";
import {
  registerCheckInstanceHealthTool,
} from "../tools/health.js";
import {
  registerCreateKbArticleTool,
  registerCreateKbCategoryTool,
  registerGetKbArticleTool,
  registerGetKnowledgeBaseTool,
  registerListKbArticlesTool,
  registerListKbCategoriesTool,
  registerListKnowledgeBasesTool,
  registerPublishKbArticleTool,
  registerUpdateKbArticleTool,
} from "../tools/knowledge.js";
import {
  registerLookupAppTool,
} from "../tools/lookup-app.js";
import {
  registerLookupColumnsTool,
} from "../tools/lookup-columns.js";
import {
  registerLookupTableTool,
} from "../tools/lookup-table.js";
import {
  registerQueryDeleteRecordsTool,
  registerQueryUpdateRecordsTool,
} from "../tools/query-batch.js";
import {
  registerQuerySyslogTool,
} from "../tools/query-syslog.js";
import {
  registerQueryTableTool,
} from "../tools/query-table.js";
import {
  registerDiscoverTableSchemaTool,
  registerExplainFieldTool,
  registerValidateCatalogTool,
} from "../tools/schema.js";
import {
  registerGetCurrentScopeTool,
  registerListScopedAppsTool,
  registerSetCurrentScopeTool,
} from "../tools/scope.js";
import {
  registerPullScriptTool,
  registerPushScriptTool,
} from "../tools/scriptsync.js";
import {
  registerAddTaskCommentTool,
  registerApproveChangeTool,
  registerAssignTaskTool,
  registerCloseIncidentTool,
  registerFindTaskTool,
  registerResolveIncidentTool,
} from "../tools/task.js";
import {
  registerCloneUpdateSetTool,
  registerCreateUpdateSetTool,
  registerGetCurrentUpdateSetTool,
  registerInspectUpdateSetTool,
  registerListUpdateSetsTool,
  registerMoveUpdateSetRecordsTool,
  registerSetCurrentUpdateSetTool,
} from "../tools/updateset.js";
import {
  registerCreateWorkflowTool,
} from "../tools/workflow.js";
import {
  registerExportRecordXmlTool,
  registerImportRecordsXmlTool,
} from "../tools/xml-record.js";

/** Registers exactly one tool on the server. */
export type ToolRegistrar = (server: McpServer) => void;

export const TOOL_REGISTRY: Record<string, ToolRegistrar> = {
  // ---- aggregate
  aggregate_grouped: registerAggregateGroupedTool,
  aggregate_query: registerAggregateQueryTool,
  count_records: registerCountRecordsTool,
  // ---- app-manager
  get_app_details: registerGetAppDetailsTool,
  install_from_app_repo: registerInstallFromAppRepoTool,
  install_store_app: registerInstallStoreAppTool,
  list_company_apps: registerListCompanyAppsTool,
  publish_to_app_repo: registerPublishToAppRepoTool,
  search_store_apps: registerSearchStoreAppsTool,
  update_store_app: registerUpdateStoreAppTool,
  validate_app_install: registerValidateAppInstallTool,
  // ---- atf
  run_atf_test: registerRunAtfTestTool,
  run_atf_test_suite: registerRunAtfTestSuiteTool,
  // ---- attachment
  get_attachment_info: registerGetAttachmentInfoTool,
  list_attachments: registerListAttachmentsTool,
  upload_attachment: registerUploadAttachmentTool,
  // ---- batch
  batch_create_records: registerBatchCreateRecordsTool,
  batch_update_records: registerBatchUpdateRecordsTool,
  // ---- catalog
  get_catalog_category: registerGetCatalogCategoryTool,
  get_catalog_item: registerGetCatalogItemTool,
  list_catalog_categories: registerListCatalogCategoriesTool,
  list_catalog_item_variables: registerListCatalogItemVariablesTool,
  list_catalog_items: registerListCatalogItemsTool,
  submit_catalog_request: registerSubmitCatalogRequestTool,
  // ---- cmdb
  get_cmdb_relationships: registerGetCmdbRelationshipsTool,
  traverse_cmdb_graph: registerTraverseCmdbGraphTool,
  // ---- codesearch
  add_code_search_table: registerAddCodeSearchTableTool,
  code_search: registerCodeSearchTool,
  list_code_search_groups: registerListCodeSearchGroupsTool,
  list_code_search_tables: registerListCodeSearchTablesTool,
  // ---- discovery
  list_instance_tables: registerListInstanceTablesTool,
  list_plugins: registerListPluginsTool,
  // ---- execute-script
  execute_script: registerExecuteScriptTool,
  // ---- find-atf-tests
  find_atf_tests: registerFindAtfTestsTool,
  // ---- flow
  cancel_flow: registerCancelFlowTool,
  copy_flow: registerCopyFlowTool,
  execute_action: registerExecuteActionTool,
  execute_flow: registerExecuteFlowTool,
  execute_subflow: registerExecuteSubflowTool,
  get_flow_context_status: registerGetFlowContextStatusTool,
  get_flow_error: registerGetFlowErrorTool,
  get_flow_execution_details: registerGetFlowExecutionDetailsTool,
  get_flow_logs: registerGetFlowLogsTool,
  get_flow_outputs: registerGetFlowOutputsTool,
  test_flow: registerTestFlowTool,
  // ---- health
  check_instance_health: registerCheckInstanceHealthTool,
  // ---- knowledge
  create_kb_article: registerCreateKbArticleTool,
  create_kb_category: registerCreateKbCategoryTool,
  get_kb_article: registerGetKbArticleTool,
  get_knowledge_base: registerGetKnowledgeBaseTool,
  list_kb_articles: registerListKbArticlesTool,
  list_kb_categories: registerListKbCategoriesTool,
  list_knowledge_bases: registerListKnowledgeBasesTool,
  publish_kb_article: registerPublishKbArticleTool,
  update_kb_article: registerUpdateKbArticleTool,
  // ---- lookup-app
  lookup_app: registerLookupAppTool,
  // ---- lookup-columns
  lookup_columns: registerLookupColumnsTool,
  // ---- lookup-table
  lookup_table: registerLookupTableTool,
  // ---- query-batch
  query_delete_records: registerQueryDeleteRecordsTool,
  query_update_records: registerQueryUpdateRecordsTool,
  // ---- query-syslog
  query_syslog: registerQuerySyslogTool,
  // ---- query-table
  query_table: registerQueryTableTool,
  // ---- schema
  discover_table_schema: registerDiscoverTableSchemaTool,
  explain_field: registerExplainFieldTool,
  validate_catalog: registerValidateCatalogTool,
  // ---- scope
  get_current_scope: registerGetCurrentScopeTool,
  list_scoped_apps: registerListScopedAppsTool,
  set_current_scope: registerSetCurrentScopeTool,
  // ---- scriptsync
  pull_script: registerPullScriptTool,
  push_script: registerPushScriptTool,
  // ---- task
  add_task_comment: registerAddTaskCommentTool,
  approve_change: registerApproveChangeTool,
  assign_task: registerAssignTaskTool,
  close_incident: registerCloseIncidentTool,
  find_task: registerFindTaskTool,
  resolve_incident: registerResolveIncidentTool,
  // ---- updateset
  clone_update_set: registerCloneUpdateSetTool,
  create_update_set: registerCreateUpdateSetTool,
  get_current_update_set: registerGetCurrentUpdateSetTool,
  inspect_update_set: registerInspectUpdateSetTool,
  list_update_sets: registerListUpdateSetsTool,
  move_update_set_records: registerMoveUpdateSetRecordsTool,
  set_current_update_set: registerSetCurrentUpdateSetTool,
  // ---- workflow
  create_workflow: registerCreateWorkflowTool,
  // ---- xml-record
  export_record_xml: registerExportRecordXmlTool,
  import_records_xml: registerImportRecordsXmlTool,
};

/** Every tool name this server knows how to register. */
export function allToolNames(): string[] {
    return Object.keys(TOOL_REGISTRY);
}

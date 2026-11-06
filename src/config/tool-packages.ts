/**
 * Tool packages — named subsets of the tool surface.
 *
 * Every tool is registered by default, and their descriptions are long by
 * design (`execute_script`'s runs to about thirteen lines, because it has to
 * teach scoped-vs-global name qualification). That is a fixed cost paid on every
 * session, and model tool-selection accuracy degrades as the option count grows.
 * A user doing service-desk work does not need Flow Designer, ATF, or app
 * publishing in front of them.
 *
 * Selected with MCP_TOOL_PACKAGE. Unset means "full", so the default behaviour
 * is unchanged.
 *
 * ---
 *
 * ON NAMING TOOLS THAT DO NOT EXIST YET
 *
 * Packages may reference tools this server does not have. That is deliberate,
 * not sloppiness: NEX-38 (user and group tools), NEX-39 (incident and change
 * tools) and NEX-46 (workflow execution) are all open, and their tools belong in
 * these packages the day they land. Naming them now means the package is already
 * right rather than something someone has to remember to revisit.
 *
 * Unknown names are reported once at startup and skipped. They are a warning
 * rather than an error precisely because forward references are expected — but
 * they are still surfaced, because the same warning catches a genuine typo.
 */

export interface ToolPackage {
    /** Shown by list_tool_packages, so write it for whoever picks a package. */
    description: string;
    /** Tool names, or ["*"] for everything. May name tools that do not exist yet. */
    tools: string[];
}

/** Workflow Studio's debugger: start, step, inspect and end a debug run. */
const FLOW_DEBUG_TOOLS = [
    "debug_flow_start",
    "debug_flow_run_to",
    "debug_flow_step",
    "debug_flow_inspect",
    "debug_flow_breakpoints",
    "debug_flow_cancel",
    "list_flow_debug_sessions",
];

/** Legacy workflows: find, read, outline, validate and plan the move to Flow Designer. Only validate stores anything (its report). */
const WORKFLOW_READ_TOOLS = [
    "list_workflows",
    "get_workflow",
    "outline_workflow",
    "export_workflow",
    "convert_workflow",
    "validate_workflow",
    "list_workflow_activity_types",
];

/** Application metadata through the platform's forms: records, columns, choices, form and list layouts. */
const METADATA_TOOLS = [
    "insert_metadata_record",
    "update_metadata_record",
    "delete_metadata_record",
    "add_table_column",
    "remove_table_column",
    "get_choice_list",
    "set_choice",
    "remove_choice",
    "get_form_layout",
    "set_form_layout",
    "get_list_layout",
    "set_list_layout",
];

/** Every ACL and role-elevation tool: reading ACLs, and changing them into an application's update set. */
const ACL_TOOLS = [
    "list_acls",
    "get_acl",
    "get_role_elevation",
    "create_acl",
    "update_acl",
    "delete_acl",
    "add_acl_role",
    "remove_acl_role",
];

export const TOOL_PACKAGES: Record<string, ToolPackage> = {
    full: {
        description: "Every tool. The default when MCP_TOOL_PACKAGE is unset.",
        tools: ["*"],
    },

    readonly: {
        description:
            "Only tools that cannot modify anything — safe to expose when the session " +
            "should be able to investigate but never change the instance. Derived from " +
            "the readOnlyHint annotations rather than hand-listed, so it cannot drift.",
        // Resolved dynamically; see resolveReadonlyPackage in common/tool-packages.ts.
        tools: ["@readonly"],
    },

    developer: {
        description:
            "Building and debugging on an instance: scripts, schema, source sync, " +
            "update sets, scope, ACLs, logs and code search.",
        tools: [
            "execute_script",
            "query_table",
            "query_syslog",
            "count_records",
            "aggregate_query",
            "aggregate_grouped",
            "discover_table_schema",
            "discover_table_behavior",
            "get_behavior_details",
            "explain_field",
            "lookup_table",
            "lookup_columns",
            "lookup_app",
            "list_instance_tables",
            "pull_script",
            "push_script",
            "code_search",
            "list_code_search_groups",
            "list_code_search_tables",
            "add_code_search_table",
            "get_current_update_set",
            "list_update_sets",
            "create_update_set",
            "set_current_update_set",
            "inspect_update_set",
            "clone_update_set",
            "move_update_set_records",
            "restore_update_set",
            "complete_update_set",
            "move_update_set_capture",
            "export_update_set",
            "get_current_scope",
            "set_current_scope",
            "list_scoped_apps",
            "check_instance_health",
            "find_task",
            "export_record_xml",
            "import_records_xml",
            ...ACL_TOOLS,
            ...METADATA_TOOLS,
        ],
    },

    service_desk: {
        description:
            "Working tickets: find and update tasks, read knowledge, raise catalog " +
            "requests. No scripting, no schema, no app lifecycle.",
        tools: [
            "find_task",
            "query_table",
            "add_task_comment",
            "assign_task",
            "resolve_incident",
            "close_incident",
            "approve_change",
            "list_knowledge_bases",
            "list_kb_articles",
            "get_kb_article",
            "list_catalog_items",
            "get_catalog_item",
            "list_catalog_item_variables",
            "submit_catalog_request",
            "list_attachments",
            "get_attachment_info",
            // Pending NEX-39.
            "create_incident",
            "update_incident",
            "add_work_note",
        ],
    },

    admin: {
        description:
            "Instance administration: users and groups, ACLs, plugins, health, logs, active " +
            "transactions, and " +
            "scripting. Deliberately includes execute_script — an admin package " +
            "without it is not an admin package.",
        tools: [
            "query_table",
            "query_syslog",
            "count_records",
            "find_task",
            "execute_script",
            "list_plugins",
            "list_instance_tables",
            "check_instance_health",
            "list_scoped_apps",
            "get_app_details",
            "list_company_apps",
            "search_store_apps",
            "validate_app_install",
            "install_store_app",
            "update_store_app",
            "repair_store_app",
            "list_transactions",
            "kill_transaction",
            ...ACL_TOOLS,
            // Pending NEX-38.
            "find_user",
            "list_users",
            "create_user",
            "update_user",
            "list_groups",
            "get_group_members",
            "add_group_members",
            "remove_group_members",
            "assign_user_role",
            "remove_user_role",
        ],
    },

    change_manager: {
        description:
            "Change and release work: change approvals, update sets, flows and " +
            "workflows (including running flows and sending flow messages, which need " +
            "execute), and the app repo.",
        tools: [
            "find_task",
            "query_table",
            "approve_change",
            "add_task_comment",
            "get_current_update_set",
            "list_update_sets",
            "create_update_set",
            "set_current_update_set",
            "inspect_update_set",
            "clone_update_set",
            "move_update_set_records",
            "restore_update_set",
            "complete_update_set",
            "move_update_set_capture",
            "export_update_set",
            "execute_flow",
            "get_flow_context_status",
            "get_flow_outputs",
            "get_flow_error",
            "get_flow_logs",
            "cancel_flow",
            "get_flow_definition",
            "send_flow_message",
            "create_workflow",
            ...WORKFLOW_READ_TOOLS,
            "install_from_app_repo",
            "publish_to_app_repo",
            // Pending NEX-39 and NEX-46.
            "create_change_request",
            "update_change_request",
            "get_change_details",
            "add_change_task",
            "get_workflow_versions",
            "execute_workflow",
        ],
    },

    flow_developer: {
        description:
            "Flow Designer work end to end: run, test, copy, inspect and diagnose " +
            "flows, plus the schema and logs needed to debug them.",
        tools: [
            "execute_flow",
            "execute_subflow",
            "execute_action",
            "test_flow",
            "copy_flow",
            "cancel_flow",
            "get_flow_context_status",
            "get_flow_outputs",
            "get_flow_error",
            "get_flow_execution_details",
            "get_flow_logs",
            "get_flow_definition",
            "send_flow_message",
            ...FLOW_DEBUG_TOOLS,
            // Porting a legacy workflow to Flow Designer starts from reading and planning it.
            ...WORKFLOW_READ_TOOLS,
            "query_table",
            "query_syslog",
            "discover_table_schema",
            "discover_table_behavior",
            "get_behavior_details",
            "lookup_table",
            "get_current_scope",
            "set_current_scope",
            "list_scoped_apps",
        ],
    },
};

/** The package used when MCP_TOOL_PACKAGE is unset or unusable. */
export const DEFAULT_PACKAGE = "full";

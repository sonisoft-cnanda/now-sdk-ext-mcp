/**
 * Tool packages — named subsets of the tool surface.
 *
 * All 86 tools are registered by default, and their descriptions are long by
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
            "update sets, scope, logs and code search.",
        tools: [
            "execute_script",
            "query_table",
            "query_syslog",
            "count_records",
            "aggregate_query",
            "aggregate_grouped",
            "discover_table_schema",
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
            "get_current_scope",
            "set_current_scope",
            "list_scoped_apps",
            "check_instance_health",
            "find_task",
            "export_record_xml",
            "import_records_xml",
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
            "Instance administration: users and groups, plugins, health, logs, and " +
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
            "workflows, and the app repo.",
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
            "execute_flow",
            "get_flow_context_status",
            "get_flow_outputs",
            "get_flow_error",
            "get_flow_logs",
            "cancel_flow",
            "create_workflow",
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
            "query_table",
            "query_syslog",
            "discover_table_schema",
            "lookup_table",
            "get_current_scope",
            "set_current_scope",
            "list_scoped_apps",
        ],
    },
};

/** The package used when MCP_TOOL_PACKAGE is unset or unusable. */
export const DEFAULT_PACKAGE = "full";

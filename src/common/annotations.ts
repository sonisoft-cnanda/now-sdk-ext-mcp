/**
 * Tool annotations — the machine-readable risk classification for every tool.
 *
 * Until now the only signal that a tool deletes records rather than reads them
 * was prose in its description ("IMPORTANT: This PERMANENTLY DELETES..."). A
 * host client cannot act on prose, so it had to prompt for all 86 tools equally
 * — including `query_table` and `count_records`, which cannot change anything.
 * Prompting uniformly trains people to click through, which is worse than not
 * prompting at all.
 *
 * Kept as ONE table rather than inlined at 86 registration sites, because
 * NEX-40 (role-based tool filtering) needs exactly the same central metadata.
 * Building it twice would guarantee the two drift.
 *
 * These are HINTS, not guarantees. The authority on what a tool may do is the
 * ServiceNow ACLs of the authenticated user; this only describes intent.
 *
 * ---
 *
 * Classification rules used here, since the spec defaults are easy to misread:
 *
 * - `readOnlyHint: true` — cannot modify anything. destructive/idempotent are
 *   meaningless alongside it and are omitted.
 * - `destructiveHint` — DEFAULTS TO TRUE, so it must be set false explicitly for
 *   writes that only add. Reserved for operations that can lose or overwrite
 *   data that already existed.
 * - `idempotentHint` — repeating the call with identical arguments leaves the
 *   same end state. True for "set this field to X"; false for "append a comment"
 *   or "create a record", which accumulate.
 * - `openWorldHint` — TRUE FOR EVERY TOOL HERE, and set explicitly rather than
 *   left to the spec's default. All of them talk to a live ServiceNow instance,
 *   which is exactly what the spec means by an open world. It was tempting to use
 *   it to single out arbitrary code execution, but that would have been wrong in
 *   both directions: the spec default is already `true`, so the marking would
 *   have been a no-op, and leaving it off the other 80-odd would have implied
 *   they were closed-world when they are not. MCP has no hint for "runs
 *   caller-supplied logic" — the tool description carries that.
 */

export interface ToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

/** Cannot modify anything. */
const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

/** Adds something new; nothing pre-existing is lost. Repeating accumulates. */
const CREATE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/** Sets state to a given value. Nothing is destroyed; repeating is a no-op. */
const SET: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Overwrites or removes data that already existed. Repeating settles. */
const OVERWRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/** Overwrites or removes, and repeating does NOT settle. */
const OVERWRITE_ONCE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/**
 * Runs caller-supplied logic — a script or a flow someone else authored.
 *
 * Structurally identical to OVERWRITE_ONCE, because MCP has no hint that means
 * "unbounded effect". Kept as a separate name purely so this table records which
 * tools are in that category; the warning that actually reaches the model is in
 * the tool description.
 */
const ARBITRARY: ToolAnnotations = OVERWRITE_ONCE;

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
    // ---- meta: reports this server's own configuration, touches no instance.
    // Registered outside TOOL_REGISTRY because it is always available regardless
    // of the active package.
    list_tool_packages: READ,

    // ---- aggregate: server-side counts, no writes
    count_records: READ,
    aggregate_query: READ,
    aggregate_grouped: READ,

    // ---- app lifecycle
    get_app_details: READ,
    list_company_apps: READ,
    search_store_apps: READ,
    // Checks whether an install WOULD work; performs no install itself.
    validate_app_install: READ,
    // Installs change what code runs on the instance and can replace an existing
    // version, so destructive even though nothing is "deleted" in a table sense.
    install_store_app: OVERWRITE_ONCE,
    update_store_app: OVERWRITE_ONCE,
    install_from_app_repo: OVERWRITE_ONCE,
    publish_to_app_repo: OVERWRITE_ONCE,

    // ---- ATF: tests execute real logic against the instance and routinely
    // create and modify records as part of running.
    find_atf_tests: READ,
    run_atf_test: OVERWRITE_ONCE,
    run_atf_test_suite: OVERWRITE_ONCE,

    // ---- attachments
    list_attachments: READ,
    get_attachment_info: READ,
    upload_attachment: CREATE,

    // ---- batch
    batch_create_records: CREATE,
    batch_update_records: OVERWRITE,

    // ---- catalog
    list_catalog_items: READ,
    get_catalog_item: READ,
    list_catalog_categories: READ,
    get_catalog_category: READ,
    list_catalog_item_variables: READ,
    submit_catalog_request: CREATE,

    // ---- CMDB
    get_cmdb_relationships: READ,
    traverse_cmdb_graph: READ,

    // ---- code search
    code_search: READ,
    list_code_search_groups: READ,
    list_code_search_tables: READ,
    // Registering the same table twice leaves the same configuration.
    add_code_search_table: SET,

    // ---- discovery
    list_instance_tables: READ,
    list_plugins: READ,

    // ---- scripting: arbitrary server-side JavaScript with the caller's rights.
    execute_script: ARBITRARY,

    // ---- flows: running one executes whatever the flow author wrote.
    execute_flow: ARBITRARY,
    execute_subflow: ARBITRARY,
    execute_action: ARBITRARY,
    test_flow: ARBITRARY,
    get_flow_context_status: READ,
    get_flow_outputs: READ,
    get_flow_error: READ,
    get_flow_execution_details: READ,
    get_flow_logs: READ,
    // Terminates a running execution; whatever it had not yet done is lost.
    cancel_flow: OVERWRITE,
    copy_flow: CREATE,

    // ---- health
    check_instance_health: READ,

    // ---- knowledge
    list_knowledge_bases: READ,
    get_knowledge_base: READ,
    list_kb_categories: READ,
    create_kb_category: CREATE,
    list_kb_articles: READ,
    get_kb_article: READ,
    create_kb_article: CREATE,
    update_kb_article: OVERWRITE,
    // A state transition to published; repeating leaves it published.
    publish_kb_article: SET,

    // ---- lookups
    lookup_app: READ,
    lookup_columns: READ,
    lookup_table: READ,

    // ---- bulk query operations: dry-run by default, but confirm=true is the
    // most destructive thing in the surface after execute_script.
    query_update_records: OVERWRITE,
    query_delete_records: OVERWRITE,

    // ---- plain queries
    query_syslog: READ,
    query_table: READ,

    // ---- schema
    discover_table_schema: READ,
    explain_field: READ,
    validate_catalog: READ,

    // ---- scope
    get_current_scope: READ,
    list_scoped_apps: READ,
    set_current_scope: SET,

    // ---- script sync
    // Writes to the LOCAL filesystem and will overwrite an existing file. Read-only
    // with respect to ServiceNow, but "read-only" means the environment, not the
    // instance.
    pull_script: OVERWRITE,
    // Overwrites the script record on the instance.
    push_script: OVERWRITE,

    // ---- tasks: field updates and appends
    find_task: READ,
    // Appends; calling twice leaves two comments.
    add_task_comment: CREATE,
    assign_task: SET,
    resolve_incident: SET,
    close_incident: SET,
    approve_change: SET,

    // ---- update sets
    get_current_update_set: READ,
    list_update_sets: READ,
    inspect_update_set: READ,
    create_update_set: CREATE,
    set_current_update_set: SET,
    clone_update_set: CREATE,
    // Relocates customisations out of one update set into another.
    move_update_set_records: OVERWRITE,

    // ---- workflow
    create_workflow: CREATE,

    // ---- XML
    export_record_xml: READ,
    // Imports can update existing records, matched by sys_id.
    import_records_xml: OVERWRITE_ONCE,
};

/**
 * Annotations for a tool.
 *
 * Throws on an unknown name rather than returning a permissive default. An
 * unannotated tool would silently inherit the spec defaults — `readOnlyHint`
 * false, `destructiveHint` TRUE — which is safe, but it would also mean a new
 * tool could ship with no deliberate classification and nobody would notice.
 * Failing at registration makes that impossible.
 */
export function annotationsFor(toolName: string): ToolAnnotations {
    // hasOwnProperty, not bracket access: TOOL_ANNOTATIONS["constructor"] would
    // otherwise return the Object constructor — truthy — and this would hand back
    // a function instead of throwing.
    const annotations = Object.prototype.hasOwnProperty.call(TOOL_ANNOTATIONS, toolName)
        ? TOOL_ANNOTATIONS[toolName]
        : undefined;
    if (!annotations) {
        throw new Error(
            `No annotations defined for tool "${toolName}". Add it to TOOL_ANNOTATIONS ` +
                `in src/common/annotations.ts — every tool must declare whether it is read-only.`,
        );
    }
    return annotations;
}

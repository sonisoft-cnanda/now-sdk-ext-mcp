import { Requirement, Target, Verb } from "@sonisoft/now-sdk-ext-core";

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
    /**
     * What permission this tool needs. NOT part of MCP — `annotationsFor` strips both
     * of these before the annotations go over the wire.
     *
     * Carried here rather than in a second table because the completeness test already
     * guarantees every registered tool appears in TOOL_ANNOTATIONS, so a new tool
     * cannot arrive without a classification. A parallel table would drift.
     */
    verbs?: readonly Verb[];
    target?: Target;
}

/** Cannot modify anything. */
const READ: ToolAnnotations = { verbs: [], target: "instance", readOnlyHint: true, openWorldHint: true };

/** Adds something new; nothing pre-existing is lost. Repeating accumulates. */
const CREATE: ToolAnnotations = { verbs: ["write"], target: "instance", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

/** Sets state to a given value. Nothing is destroyed; repeating is a no-op. */
const SET: ToolAnnotations = { verbs: ["write"], target: "instance", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/** Overwrites or removes data that already existed. Repeating settles. */
const OVERWRITE: ToolAnnotations = { verbs: ["write"], target: "instance", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/** Overwrites or removes, and repeating does NOT settle. */
const OVERWRITE_ONCE: ToolAnnotations = { verbs: ["write"], target: "instance", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/**
 * Runs caller-supplied logic — a script or a flow someone else authored.
 *
 * Structurally identical to OVERWRITE_ONCE, because MCP has no hint that means
 * "unbounded effect". Kept as a separate name purely so this table records which
 * tools are in that category; the warning that actually reaches the model is in
 * the tool description.
 */
const ARBITRARY: ToolAnnotations = {
    ...OVERWRITE_ONCE,
    // The MCP hints stay identical to OVERWRITE_ONCE — the protocol has no hint for
    // "unbounded effect". What differs is the permission: running caller-supplied or
    // third-party logic needs `execute`, and it can write, so it needs both.
    verbs: ["execute", "write"],
};

/** Writes to the LOCAL filesystem. Read-only with respect to the instance. */
const LOCAL_WRITE: ToolAnnotations = { ...OVERWRITE, target: "local" };

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
    // ---- meta: reports this server's own configuration, touches no instance.
    // Registered outside TOOL_REGISTRY because it is always available regardless
    // of the active package.
    list_tool_packages: READ,
    // Reports this process's permission policy; also registered outside TOOL_REGISTRY.
    get_policy_status: READ,

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
    run_atf_test: ARBITRARY,
    run_atf_test_suite: ARBITRARY,

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
    // Design-time definition through the processflow API: nothing runs.
    get_flow_definition: READ,
    // Resumes a paused execution, which then runs whatever the flow author wrote next; sent from a
    // background script, so it needs execute as well as write.
    send_flow_message: ARBITRARY,

    // ---- flow debugger. A debug run executes the flow's draft for real, so starting and stepping run
    // author logic (execute+write). Breakpoints and cancel need only write, so a run stays cancellable
    // under NEX_POLICY_DENY=execute; cancel is safe to repeat.
    debug_flow_start: ARBITRARY,
    debug_flow_run_to: ARBITRARY,
    debug_flow_step: ARBITRARY,
    debug_flow_breakpoints: SET,
    debug_flow_cancel: OVERWRITE,
    debug_flow_inspect: READ,
    list_flow_debug_sessions: READ,

    // ---- cluster transactions. Listing asks the nodes to report (a GET of loading_transactions.do,
    // then status polls core declares read-only).
    list_transactions: READ,
    // Ends a running transaction part way; what it had not done is lost. Repeating settles.
    kill_transaction: OVERWRITE,

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
    discover_table_behavior: READ,
    get_behavior_details: READ,
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
    pull_script: LOCAL_WRITE,
    // Overwrites the script record on the instance.
    // A pushed script runs on the instance: core requires execute as well as write (core 6.18.7).
    push_script: { ...OVERWRITE, verbs: ["execute", "write"] },

    // ---- tasks: field updates and appends
    find_task: READ,
    // Appends; calling twice leaves two comments.
    add_task_comment: CREATE,
    assign_task: SET,
    resolve_incident: SET,
    close_incident: SET,
    approve_change: SET,

    // ---- legacy workflows: reads, except validation. validate_workflow renders the editor's report
    // page, which saves that run's results over the previous run's. Core classifies the request as a
    // read and no workflow configuration changes, but it does store something, so it is a settling
    // write here and stays out of the readonly package. (get_workflow's editor status comes from the
    // diagram processor, a plain read.)
    list_workflows: READ,
    get_workflow: READ,
    outline_workflow: READ,
    export_workflow: READ,
    convert_workflow: READ,
    validate_workflow: SET,
    list_workflow_activity_types: READ,
    // Reinstalls an installed application from the repository: like an install, it can replace
    // what is there and repeating does not settle.
    repair_store_app: OVERWRITE_ONCE,

    // ---- application metadata, through the platform's forms; every write is read back with its
    // capture. Inserting adds; updating and the layout saves overwrite what was there (a repeat
    // settles); deletes and removals lose data and a repeat is refused. Code (a script, a server
    // condition, Jelly, a javascript: value, or switching such a record on) also needs execute:
    // core's MetadataFormWriter checks that per call (core 6.18.7), so these stay plain writes.
    get_choice_list: READ,
    get_form_layout: READ,
    get_list_layout: READ,
    insert_metadata_record: CREATE,
    update_metadata_record: OVERWRITE,
    delete_metadata_record: OVERWRITE_ONCE,
    // Adding a column adds; a repeat is refused (column_exists).
    add_table_column: CREATE,
    // Deletes the column's data with it.
    remove_table_column: OVERWRITE_ONCE,
    // Adds a choice or changes one; a repeat with the same values is refused as unchanged (settles).
    set_choice: OVERWRITE,
    remove_choice: OVERWRITE_ONCE,
    set_form_layout: OVERWRITE,
    set_list_layout: OVERWRITE,

    // ---- access controls. Reads change nothing. Elevating a session (get_role_elevation, or
    // elevate on a read) changes no instance data, so it is a read: a deliberate decision, so a
    // read-only session can still read what only security_admin may see (README: Role elevation).
    list_acls: READ,
    get_acl: READ,
    get_role_elevation: READ,
    // The writes change who may do what. Creating an ACL or adding a role only adds a way in
    // (not destructive); updating, deleting or removing a role can open access as well as
    // close it (destructive). Code on an ACL (a script or javascript: condition) needs execute
    // too, but only when a call carries it, so it is not a static verb here (that would refuse
    // role-only ACLs under deny-execute): core's AclManager checks write+execute against the
    // same installed policy before writing code (core 6.18.5).
    create_acl: CREATE,
    // Repeating with the same values leaves the same ACL.
    update_acl: OVERWRITE,
    // A repeat call is refused (acl_not_found, role_already_present, role_not_present): not
    // idempotent, so a client must not retry them on its own.
    delete_acl: OVERWRITE_ONCE,
    add_acl_role: CREATE,
    remove_acl_role: OVERWRITE_ONCE,

    // ---- update sets
    get_current_update_set: READ,
    list_update_sets: READ,
    inspect_update_set: READ,
    // Switching the working set runs a background script (the preferences are saved server-side),
    // and so does creating a set: application is required, and core creates an application's set
    // with a script (duplicate check, read-back).
    create_update_set: { ...CREATE, verbs: ["execute", "write"] },
    set_current_update_set: { ...SET, verbs: ["execute", "write"] },
    restore_update_set: { ...SET, verbs: ["execute", "write"] },
    // A state transition, checked and read back; a second call is refused (update_set_closed).
    complete_update_set: { ...SET, idempotentHint: false },
    // Moves one capture between sets; a second call is refused (capture_not_in_source).
    move_update_set_capture: { ...OVERWRITE_ONCE, destructiveHint: false },
    // Copies the set into a temporary Retrieved Update Set (background script, then deleted) and
    // writes a local file; replace can overwrite that file.
    export_update_set: { verbs: ["execute", "write"], target: "instance", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
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

/** What permission a tool needs. Throws on an unknown name — see `lookup`. */
export function requirementFor(toolName: string): Requirement {
    const annotations = lookup(toolName);
    return {
        verbs: annotations.verbs ?? ["write"],
        target: annotations.target ?? "instance",
    };
}

/**
 * The raw table entry, including the non-MCP fields.
 *
 * Throws on an unknown name rather than returning a permissive default. An unannotated
 * tool would silently inherit the spec defaults — `readOnlyHint` false,
 * `destructiveHint` TRUE — which is safe on the wire, but it would also mean a new tool
 * could ship with no deliberate permission classification and nobody would notice.
 * Because the guard calls this at REGISTRATION, failing here stops the server booting.
 */
function lookup(toolName: string): ToolAnnotations {
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

/** The annotations sent to the client. */
export function annotationsFor(toolName: string): ToolAnnotations {
    // `verbs` and `target` are ours, not MCP's. Strip them here so nothing
    // non-standard reaches the client — the wire shape is unchanged by this feature.
    const { verbs: _verbs, target: _target, ...wire } = lookup(toolName);
    return wire;
}

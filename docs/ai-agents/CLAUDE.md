# NEX MCP Server — AI Agent Guidance

> This file provides AI coding assistants (Claude Code, Cursor, Windsurf, etc.) with comprehensive guidance on using the `now-sdk-ext-mcp` MCP server to automate ServiceNow platform operations. Copy this file to your project root or include it in your agent's context.

---

## Overview

`now-sdk-ext-mcp` (`@sonisoft/now-sdk-ext-mcp`) is an MCP (Model Context Protocol) server that exposes ServiceNow operations as tools your AI assistant can invoke directly. It provides 70+ tools across 18 categories covering data querying, script execution, flow management, testing, deployment, and more.

**Authentication** is handled via an optional `instance` parameter on every tool. Resolution order: tool `instance` parameter → `SN_AUTH_ALIAS` environment variable. If the user says "on my dev instance", pass `instance: "dev"`. If neither is available, the tool returns a clear error.

## Authentication

```
# Every tool accepts an optional "instance" parameter (the auth alias)
# If omitted, the SN_AUTH_ALIAS environment variable is used

# Auth aliases are configured via the ServiceNow SDK CLI:
now-sdk auth add --alias dev --host https://dev12345.service-now.com
```

---

## Quick Reference

All tools at a glance:

| Tool | Description |
|------|-------------|
| **Data Querying** | |
| `query_table` | Query any ServiceNow table with encoded queries, field selection, display values |
| `count_records` | Count records on a table (server-side, efficient) |
| `aggregate_query` | Run aggregate functions (COUNT, AVG, MIN, MAX, SUM) without grouping |
| `aggregate_grouped` | Run aggregate functions grouped by field(s) for per-group breakdowns |
| `query_syslog` | Query system log for errors, warnings, debug output |
| **Schema & Discovery** | |
| `lookup_table` | Search for tables by name or label |
| `lookup_columns` | List or search columns on a table |
| `lookup_app` | Search for applications and plugins by name, scope, or plugin ID |
| `discover_table_schema` | Full table schema: fields, types, references, choices, business rules |
| `explain_field` | Detailed field explanation: type, constraints, help text, choice values |
| `validate_catalog` | Validate a catalog item's configuration |
| `list_instance_tables` | List tables with filtering by prefix, scope, extendability |
| `list_plugins` | List platform plugins with active status |
| **Script Execution** | |
| `execute_script` | Execute JavaScript via Scripts - Background (full GlideSystem API) |
| **Code & Scripts** | |
| `code_search` | Search for code across the instance (business rules, script includes, etc.) |
| `list_code_search_groups` | List available code search groups |
| `list_code_search_tables` | List tables in a search group |
| `add_code_search_table` | Add a table to a search group |
| `pull_script` | Pull a script from instance to local file |
| `push_script` | Push a local script file to instance |
| **ATF Testing** | |
| `find_atf_tests` | Search for ATF tests by name, description, category |
| `run_atf_test` | Execute a single ATF test and wait for result |
| `run_atf_test_suite` | Execute an ATF test suite and wait for all tests |
| **Flow Designer** | |
| `execute_flow` | Execute a published flow (foreground or background) |
| `execute_subflow` | Execute a published subflow |
| `execute_action` | Execute a flow action |
| `test_flow` | Test a flow without requiring it to be published |
| `copy_flow` | Copy a flow into a target scoped application |
| `get_flow_context_status` | Get the status of a flow execution context |
| `get_flow_execution_details` | Per-action execution breakdown: inputs, outputs, timing |
| `get_flow_logs` | Execution log entries for a flow context |
| `get_flow_outputs` | Outputs from a completed flow execution |
| `get_flow_error` | Error message from a failed flow execution |
| `cancel_flow` | Cancel a running or paused flow execution |
| **Task Management** | |
| `find_task` | Find a task by its number (INC, CHG, PRB, etc.) |
| `add_task_comment` | Add a comment or work note to any task record |
| `assign_task` | Assign a task to a user and/or group |
| `resolve_incident` | Resolve an incident with resolution notes |
| `close_incident` | Close an incident with close notes |
| `approve_change` | Approve a change request |
| **Batch & Bulk Operations** | |
| `batch_create_records` | Create multiple records with cross-references via saveAs |
| `batch_update_records` | Update multiple records across tables |
| `query_update_records` | Find-and-update records matching a query (dry-run by default) |
| `query_delete_records` | Find-and-delete records matching a query (dry-run by default) |
| **Attachments** | |
| `list_attachments` | List attachments on a record |
| `get_attachment_info` | Get metadata for a specific attachment |
| `upload_attachment` | Upload a file (base64) to a record |
| **Update Sets** | |
| `get_current_update_set` | Get the active update set for the session |
| `list_update_sets` | List update sets with filtering |
| `create_update_set` | Create a new update set |
| `set_current_update_set` | Set the active update set |
| `inspect_update_set` | Inspect update set contents grouped by type |
| `clone_update_set` | Clone an update set and its records |
| `move_update_set_records` | Move records between update sets |
| **Application Scope** | |
| `get_current_scope` | Get the current application scope |
| `set_current_scope` | Change the active application scope |
| `list_scoped_apps` | List scoped applications on the instance |
| **App Management** | |
| `get_app_details` | Get application details (version, status, dependencies) |
| `validate_app_install` | Validate app install requirements |
| `search_store_apps` | Search the ServiceNow Store |
| `list_company_apps` | List company-internal applications |
| `install_store_app` | Install a store application |
| `update_store_app` | Update an installed store application |
| `install_from_app_repo` | Install from company app repository |
| `publish_to_app_repo` | Publish to company app repository |
| **Service Catalog** | |
| `list_catalog_items` | List catalog items with text search and filtering |
| `get_catalog_item` | Get catalog item details with variables |
| `list_catalog_categories` | List catalog categories |
| `get_catalog_category` | Get category details |
| `list_catalog_item_variables` | List variables (form fields) for a catalog item |
| `submit_catalog_request` | Submit a catalog request (order now) |
| **Knowledge Management** | |
| `list_knowledge_bases` | List knowledge bases |
| `get_knowledge_base` | Get KB details with article/category counts |
| `list_kb_categories` | List KB categories |
| `create_kb_category` | Create a KB category |
| `list_kb_articles` | List article summaries with filtering |
| `get_kb_article` | Get full article content |
| `create_kb_article` | Create a new article (draft by default) |
| `update_kb_article` | Update an existing article |
| `publish_kb_article` | Publish a draft article |
| **CMDB** | |
| `get_cmdb_relationships` | Get direct CI relationships (upstream/downstream) |
| `traverse_cmdb_graph` | BFS traversal of CMDB relationship graph |
| **Health & Monitoring** | |
| `check_instance_health` | Consolidated health check (version, cluster, stuck jobs, semaphores) |
| **Workflows** | |
| `create_workflow` | Create a complete workflow from specification |
| **XML Records** | |
| `export_record_xml` | Export a record as ServiceNow unload XML |
| `import_records_xml` | Import XML records into an instance |

---

## ServiceNow Platform Concepts

Understanding these concepts is essential for constructing correct tool parameters.

### Encoded Query Syntax

Most query tools accept an `query` parameter using ServiceNow's encoded query syntax. This is the same format used in list view URL parameters.

**Operators:**

| Operator | Meaning | Example |
|----------|---------|---------|
| `=` | Equals | `active=true` |
| `!=` | Not equals | `state!=7` |
| `LIKE` | Contains | `short_descriptionLIKEnetwork` |
| `STARTSWITH` | Starts with | `numberSTARTSWITHINC` |
| `ENDSWITH` | Ends with | `nameENDSWITHUtils` |
| `>` | Greater than | `priority>2` |
| `<` | Less than | `priority<3` |
| `>=` | Greater or equal | `sys_created_on>=2024-01-01` |
| `<=` | Less or equal | `reassignment_count<=2` |
| `IN` | In list | `stateIN1,2,3` |
| `NOT IN` | Not in list | `stateNOT IN6,7` |
| `ISEMPTY` | Is empty/null | `assigned_toISEMPTY` |
| `ISNOTEMPTY` | Is not empty | `assigned_toISNOTEMPTY` |
| `INSTANCEOF` | Table hierarchy | `sys_class_nameINSTANCEOFtask` |

**Combining conditions:**

| Separator | Meaning | Example |
|-----------|---------|---------|
| `^` | AND | `active=true^priority=1` |
| `^OR` | OR | `priority=1^ORpriority=2` |
| `^NQ` | New query (UNION) | `active=true^NQstate=6` |

**Ordering:**

| Syntax | Meaning |
|--------|---------|
| `ORDERBY<field>` | Ascending sort |
| `ORDERBYDESC<field>` | Descending sort |

**Examples:**
```
# Active P1 incidents assigned to someone
active=true^priority=1^assigned_toISNOTEMPTY

# Incidents created this year, ordered newest first
sys_created_on>=2024-01-01^ORDERBYDESCsys_created_on

# Open or in-progress, not priority 5
stateIN1,2^priority!=5

# Records in a specific scope
sys_scopeSTARTSWITHx_acme_
```

### GlideSystem API (for `execute_script`)

The `execute_script` tool runs JavaScript on the instance via Scripts - Background. You have full access to the GlideSystem API. Output is captured from `gs.print()` calls.

**Key classes and functions:**

```javascript
// GlideRecord — query and manipulate records
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.addQuery('priority', '1');
gr.setLimit(10);
gr.orderByDesc('sys_created_on');
gr.query();
while (gr.next()) {
    gs.print(gr.number + ': ' + gr.short_description);
}

// GlideRecord — create a record
var gr = new GlideRecord('incident');
gr.initialize();
gr.short_description = 'New incident from script';
gr.priority = 3;
gr.category = 'software';
var sys_id = gr.insert();
gs.print('Created: ' + sys_id);

// GlideRecord — update a record
var gr = new GlideRecord('incident');
if (gr.get('number', 'INC0010042')) {
    gr.priority = 1;
    gr.update();
    gs.print('Updated ' + gr.number);
}

// GlideAggregate — efficient counting and aggregation
var ga = new GlideAggregate('incident');
ga.addQuery('active', true);
ga.addAggregate('COUNT');
ga.query();
if (ga.next()) {
    gs.print('Active incidents: ' + ga.getAggregate('COUNT'));
}

// GlideAggregate — group by
var ga = new GlideAggregate('incident');
ga.addQuery('active', true);
ga.addAggregate('COUNT');
ga.groupBy('priority');
ga.orderByAggregate('COUNT', 'priority');
ga.query();
while (ga.next()) {
    gs.print('Priority ' + ga.priority + ': ' + ga.getAggregate('COUNT'));
}

// GlideDateTime — date/time operations
var gdt = new GlideDateTime();
gs.print('Now: ' + gdt.getDisplayValue());
gdt.addDaysUTC(-7);
gs.print('7 days ago: ' + gdt.getValue());

// gs utility functions
gs.print(gs.now());                          // Current date-time
gs.print(gs.getUserID());                    // Current user sys_id
gs.print(gs.getUserName());                  // Current username
gs.print(gs.hasRole('admin'));               // Role check
gs.print(gs.getProperty('glide.servlet.uri')); // System property
gs.print(gs.tableExists('incident'));        // Table existence check

// GlideRecord — encoded query (same syntax as query tools)
var gr = new GlideRecord('incident');
gr.addEncodedQuery('active=true^priority=1^assigned_toISNOTEMPTY');
gr.query();
gs.print('Matching records: ' + gr.getRowCount());

// GlideElement — field operations
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.setLimit(1);
gr.query();
if (gr.next()) {
    gs.print('Display value: ' + gr.priority.getDisplayValue());
    gs.print('Reference: ' + gr.assigned_to.getRefRecord().getDisplayValue());
    gs.print('Is empty: ' + gr.work_notes.nil());
}

// GlideSysAttachment — working with attachments
var sa = new GlideSysAttachment();
var content = sa.getContent('sys_attachment', attachment_sys_id);

// Scoped script execution — use the scope parameter
// execute_script with scope: "x_acme_my_app" runs in that app's context
```

**Parameter substitution** — The `execute_script` tool supports a `params` object. Reference params in your script with `${key}`:

```javascript
// Tool call: execute_script({ script: "...", params: { table: "incident", field: "priority", value: "1" } })
var gr = new GlideRecord('${table}');
gr.addQuery('${field}', '${value}');
gr.query();
gs.print('Count: ' + gr.getRowCount());
```

### Table Hierarchy

ServiceNow uses single-table inheritance. Key relationships:

```
task
├── incident
├── change_request
│   ├── change_request_imac
│   └── std_change_proposal
├── problem
├── sc_request
├── sc_req_item
├── sc_task
├── kb_submission
└── sn_si_incident (Security Incident)

cmdb
└── cmdb_ci
    ├── cmdb_ci_computer
    │   ├── cmdb_ci_server
    │   └── cmdb_ci_pc_hardware
    ├── cmdb_ci_service
    │   └── cmdb_ci_service_auto
    ├── cmdb_ci_appl
    └── cmdb_ci_database

sys_metadata
├── sys_script (Business Rules)
├── sys_script_include (Script Includes)
├── sys_ui_script (UI Scripts)
├── sys_ui_action (UI Actions)
├── sys_script_client (Client Scripts)
├── sys_ui_page (UI Pages)
└── sys_ui_policy (UI Policies)
```

Use `INSTANCEOF` in encoded queries to query across a hierarchy: `sys_class_nameINSTANCEOFtask` finds all tasks including incidents, changes, etc.

### Common Tables

| Table | Label | Description |
|-------|-------|-------------|
| `incident` | Incident | IT incidents |
| `change_request` | Change Request | Change management |
| `problem` | Problem | Problem management |
| `sc_request` | Request | Service catalog requests |
| `sc_req_item` | Request Item | Individual catalog items ordered |
| `sc_task` | Catalog Task | Tasks spawned from catalog requests |
| `kb_knowledge` | Knowledge | Knowledge articles |
| `kb_knowledge_base` | Knowledge Base | Knowledge base containers |
| `cmdb_ci` | Configuration Item | CMDB base CI table |
| `sys_user` | User | User records |
| `sys_user_group` | Group | User groups |
| `sys_script_include` | Script Include | Reusable server-side scripts |
| `sys_script` | Business Rule | Table-triggered server-side logic |
| `sys_ui_script` | UI Script | Client-side script libraries |
| `sys_ui_policy` | UI Policy | Dynamic form behavior |
| `sys_choice` | Choice | Choice list values |
| `sys_db_object` | Table | Table definitions |
| `sys_dictionary` | Dictionary Entry | Field/column definitions |
| `sys_properties` | System Property | Configuration properties |
| `syslog` | System Log | Application and debug logs |
| `sys_update_set` | Update Set | Change tracking containers |
| `sys_app` | Application | Scoped applications |
| `sc_cat_item` | Catalog Item | Service catalog items |
| `sc_category` | Category | Catalog categories |
| `sys_flow_context` | Flow Context | Flow execution records |

### Application Scopes

ServiceNow applications run in scopes that control access and namespacing:

- **Global scope** (`global`): Default scope, can access everything
- **Scoped apps** (`x_<vendor>_<app>`): Isolated namespace with controlled cross-scope access
- The `execute_script` tool has a `scope` parameter (default: `"global"`)
- Use `get_current_scope` / `set_current_scope` to manage the session scope
- Scope affects which tables and records scripts can access

### Update Sets

Update sets track configuration changes for migration between instances:

- All customizations are captured in the current update set
- Use `create_update_set` → `set_current_update_set` before making changes
- Use `inspect_update_set` to review what was captured
- Use `clone_update_set` to create backups before deployment

---

## Tool Reference

### Data Querying

#### `query_table`

Query any ServiceNow table. Returns records matching specified criteria.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias for the target instance |
| `table` | string | yes | — | Table name to query |
| `query` | string | no | — | Encoded query string for filtering |
| `fields` | string | no | all | Comma-separated field names to return |
| `limit` | number | no | `20` | Maximum records (max 1000) |
| `display_value` | boolean | no | `false` | Return display values for reference/choice fields |

**Examples:**
```
# Active P1 incidents, showing key fields
query_table(table: "incident", query: "active=true^priority=1", fields: "number,short_description,state,assigned_to", display_value: true)

# Recent changes ordered by creation date
query_table(table: "change_request", query: "ORDERBYDESCsys_created_on", limit: 5)

# Users in a specific group
query_table(table: "sys_user_grmember", query: "group.name=Network", fields: "user.name,user.email")
```

#### `count_records`

Count records on a table. Uses the Stats API for efficient server-side counting — much faster than querying all records.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `query` | string | no | — | Encoded query to filter |

```
count_records(table: "incident", query: "active=true^priority=1")
```

#### `aggregate_query`

Run aggregate functions (COUNT, AVG, MIN, MAX, SUM) on a table without grouping.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `query` | string | no | — | Encoded query to filter |
| `count` | boolean | no | — | Include COUNT |
| `avg_fields` | string[] | no | — | Fields for AVG |
| `min_fields` | string[] | no | — | Fields for MIN |
| `max_fields` | string[] | no | — | Fields for MAX |
| `sum_fields` | string[] | no | — | Fields for SUM |

```
aggregate_query(table: "incident", query: "active=true", count: true, avg_fields: ["reassignment_count"])
```

#### `aggregate_grouped`

Grouped aggregate queries — ideal for breakdowns and dashboards.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `group_by` | string[] | yes | — | Fields to group by |
| `query` | string | no | — | Encoded query to filter |
| `count` | boolean | no | — | Include COUNT per group |
| `avg_fields` | string[] | no | — | Fields for AVG per group |
| `min_fields` | string[] | no | — | Fields for MIN per group |
| `max_fields` | string[] | no | — | Fields for MAX per group |
| `sum_fields` | string[] | no | — | Fields for SUM per group |
| `having` | string | no | — | HAVING clause (e.g., `"count>10"`) |
| `display_value` | string | no | — | Display value handling |

```
# Incident count by priority
aggregate_grouped(table: "incident", group_by: ["priority"], count: true, query: "active=true")

# Multi-group with having filter
aggregate_grouped(table: "incident", group_by: ["priority", "state"], count: true, having: "count>5")
```

#### `query_syslog`

Query the system log. Results ordered newest-first.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `query` | string | no | — | Encoded query for filtering |
| `level` | string | no | — | Filter by level: `error`, `warning`, `info`, `debug` |
| `source` | string | no | — | Filter by log source |
| `limit` | number | no | `50` | Maximum entries (max 500) |
| `table` | string | no | `syslog` | `syslog` or `syslog_app_scope` |

```
query_syslog(level: "error", limit: 20)
query_syslog(query: "messageLIKEACL", source: "security")
```

---

### Schema & Discovery

#### `lookup_table`

Search for tables by name or label. Queries `sys_db_object`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `search_term` | string | yes | — | Table name or label to search for |
| `limit` | number | no | `25` | Maximum results (max 100) |

```
lookup_table(search_term: "incident")
lookup_table(search_term: "cmdb_ci")
```

#### `lookup_columns`

List or search columns on a table. Queries `sys_dictionary`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `search_term` | string | no | — | Filter by element name or label |
| `limit` | number | no | `50` | Maximum columns (max 200) |

```
lookup_columns(table: "incident", search_term: "caller")
```

#### `discover_table_schema`

Full table schema including fields, types, references, and optionally choices, relationships, UI policies, and business rules.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `include_choices` | boolean | no | — | Include choice values |
| `include_relationships` | boolean | no | — | Include relationship info |
| `include_ui_policies` | boolean | no | — | Include UI policies |
| `include_business_rules` | boolean | no | — | Include business rules |

```
discover_table_schema(table: "incident", include_choices: true, include_business_rules: true)
```

#### `explain_field`

Get detailed explanation of a specific field.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `field` | string | yes | — | Field element name |

```
explain_field(table: "incident", field: "state")
```

#### `list_instance_tables`

List tables with optional filtering.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `name_prefix` | string | no | — | Filter by name prefix |
| `scope` | string | no | — | Filter by application scope |
| `extendable_only` | boolean | no | — | Only extendable tables |
| `query` | string | no | — | Encoded query |
| `limit` | number | no | `50` | Max tables (max 500) |
| `offset` | number | no | — | Pagination offset |

#### `list_plugins`

List platform plugins.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `name_prefix` | string | no | — | Filter by name prefix |
| `active_only` | boolean | no | `true` | Only active plugins |
| `query` | string | no | — | Encoded query |
| `limit` | number | no | `50` | Max plugins (max 500) |

---

### Script Execution

#### `execute_script`

Execute JavaScript on the instance via Scripts - Background. Full GlideSystem API access. See the [GlideSystem API](#glidesystem-api-for-execute_script) section for scripting patterns.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `script` | string | yes | — | JavaScript code to execute |
| `scope` | string | no | `"global"` | Application scope |
| `params` | object | no | — | Key-value pairs for `${key}` substitution |

> **Warning**: This executes code directly on the instance. Prefer read-only operations unless modification is explicitly intended.

```
# Count active incidents
execute_script(script: "var gr = new GlideRecord('incident'); gr.addQuery('active', true); gr.query(); gs.print('Count: ' + gr.getRowCount());")

# With parameter substitution
execute_script(
  script: "var gr = new GlideRecord('${table}'); gr.addQuery('active', true); gr.query(); gs.print(gr.getRowCount());",
  params: { table: "incident" }
)

# In a specific scope
execute_script(script: "gs.print(gs.getCurrentScopeName());", scope: "x_acme_my_app")
```

---

### Code & Scripts

#### `code_search`

Search for code across the instance using the Code Search API.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `term` | string | yes | — | Search term |
| `search_group` | string | no | — | Search group NAME to scope the search |
| `table` | string | no | — | Specific table to search within |
| `current_app` | string | no | — | Application scope to limit results |
| `search_all_scopes` | boolean | no | — | Search across all scopes |
| `limit` | number | no | — | Max results |

```
code_search(term: "getRowCount")
code_search(term: "IncidentUtils", table: "sys_script_include")
```

#### `pull_script` / `push_script`

Pull scripts from instance to local files, or push local scripts to instance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `script_name` | string | yes | Name of the script record |
| `script_type` | string | yes | Type: `sys_script_include`, `sys_script`, `sys_ui_script`, `sys_ui_action`, `sys_script_client` |
| `file_path` | string | yes | Local file path |

```
pull_script(script_name: "IncidentUtils", script_type: "sys_script_include", file_path: "./scripts/IncidentUtils.js")
push_script(script_name: "IncidentUtils", script_type: "sys_script_include", file_path: "./scripts/IncidentUtils.js")
```

---

### ATF Testing

#### `find_atf_tests`

Search for ATF tests.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `search_term` | string | no | — | Search in name and description |
| `category` | string | no | — | Filter by category |
| `active` | boolean | no | `true` | Filter by active status |
| `limit` | number | no | `25` | Max tests (max 100) |

#### `run_atf_test`

Execute a single ATF test. Waits for completion and returns result.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `test_sys_id` | string | yes | Sys_id of the test |

#### `run_atf_test_suite`

Execute a test suite. Identify by name or sys_id.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `suite_name` | string | exclusive | Suite name |
| `suite_sys_id` | string | exclusive | Suite sys_id |
| `browser_name` | string | no | Browser for UI tests |
| `browser_version` | string | no | Browser version |
| `os_name` | string | no | OS for UI tests |
| `os_version` | string | no | OS version |

---

### Flow Designer

#### `execute_flow` / `execute_subflow` / `execute_action`

Execute published flows, subflows, or actions. In foreground mode (default), blocks until completion. In background mode, returns a context ID for polling.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `scoped_name` | string | yes | — | Scoped name (e.g., `"global.my_flow"`) |
| `inputs` | object | no | — | Input name-value pairs |
| `mode` | string | no | `"foreground"` | `"foreground"` or `"background"` |
| `timeout` | number | no | — | Timeout in ms (foreground only) |
| `quick` | boolean | no | — | Skip execution detail records |
| `scope` | string | no | — | Scope context |

> Flows with approval/wait steps **must** use background mode.

```
execute_flow(scoped_name: "global.my_flow", inputs: { record: "INC0010042" })
execute_flow(scoped_name: "global.approval_flow", mode: "background")
```

#### `test_flow`

Test a flow without requiring it to be published. Same API as the "Test" button in Flow Designer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `flow_id` | string | yes | Flow sys_id or scoped name |
| `output_map` | object | yes | Maps trigger output variable names to test values |
| `scope` | string | no | Scope sys_id |

```
test_flow(flow_id: "abc123", output_map: { record: "INC0010042" })
```

#### `copy_flow`

Copy an existing flow into a target scoped application. Best-practice first step for modifying any flow.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `source_flow_id` | string | yes | Source flow sys_id or scoped name |
| `name` | string | yes | Display name for the copy |
| `target_scope` | string | yes | Scope sys_id of target application |

#### Diagnostic Tools

| Tool | Parameter | Returns |
|------|-----------|---------|
| `get_flow_context_status` | `context_id` | Quick state: COMPLETE, ERROR, IN_PROGRESS, WAITING, QUEUED, CANCELLED |
| `get_flow_execution_details` | `context_id` | Per-action breakdown: inputs, outputs, timing, state |
| `get_flow_logs` | `context_id`, `limit`, `order_direction` | Execution log entries |
| `get_flow_outputs` | `context_id` | Flow-level output values |
| `get_flow_error` | `context_id` | Error message from failed execution |
| `cancel_flow` | `context_id`, `reason` | Cancel running/paused execution |

---

### Task Management

#### `find_task`

Find a task by its number (e.g., INC0010001, CHG0030002).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `table` | string | yes | Table name (e.g., `incident`, `change_request`) |
| `number` | string | yes | Task number |

#### `add_task_comment`

Add a comment or work note to any task-based record.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `record_sys_id` | string | yes | — | Record sys_id |
| `comment` | string | yes | — | Comment text |
| `is_work_note` | boolean | no | `false` | If true, adds internal work note |

#### `assign_task`

Assign a task to a user and optionally a group.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `table` | string | yes | Table name |
| `record_sys_id` | string | yes | Record sys_id |
| `assigned_to` | string | yes | User sys_id or user_name |
| `assignment_group` | string | no | Group sys_id |

#### `resolve_incident` / `close_incident`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `sys_id` | string | yes | Incident sys_id |
| `resolution_notes` / `close_notes` | string | yes | Notes |
| `close_code` | string | no | Close code |

#### `approve_change`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `sys_id` | string | yes | Change request sys_id |
| `comments` | string | no | Approval comments |

---

### Batch & Bulk Operations

#### `batch_create_records`

Create multiple records with cross-references. Operations execute sequentially, supporting variable references via saveAs/substitution.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `operations` | array | yes | — | List of `{ table, data, saveAs? }` |
| `transaction` | boolean | no | `true` | Stop on first error |

```
batch_create_records(operations: [
  { table: "sys_user_group", data: { name: "My Team" }, saveAs: "group1" },
  { table: "incident", data: { short_description: "Test", assignment_group: "${group1}" } }
])
```

#### `batch_update_records`

Update multiple records across tables.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `updates` | array | yes | — | List of `{ table, sysId, data }` |
| `stop_on_error` | boolean | no | `false` | Stop on first error |

#### `query_update_records` / `query_delete_records`

Find records matching a query and update/delete them. **Dry-run by default** — set `confirm: true` to execute.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `query` | string | yes | — | Encoded query |
| `data` | object | yes (update only) | — | Fields to set |
| `confirm` | boolean | no | `false` | `true` to execute, `false` for dry-run |
| `limit` | number | no | — | Max records |

> **Safety**: Always run with `confirm: false` first to preview affected records, then set `confirm: true`.

```
# Preview (dry run)
query_update_records(table: "incident", query: "active=true^priority=5", data: { priority: "4" }, confirm: false)

# Execute
query_update_records(table: "incident", query: "active=true^priority=5", data: { priority: "4" }, confirm: true)
```

---

### Attachments

#### `list_attachments`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `table` | string | yes | — | Table name |
| `record_sys_id` | string | yes | — | Record sys_id |
| `limit` | number | no | `50` | Max attachments (max 200) |

#### `get_attachment_info`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `sys_id` | string | yes | Attachment sys_id |

#### `upload_attachment`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instance` | string | no | Auth alias |
| `table` | string | yes | Table name |
| `record_sys_id` | string | yes | Record sys_id |
| `file_name` | string | yes | File name with extension |
| `content_type` | string | yes | MIME type |
| `content_base64` | string | yes | Base64-encoded file content |

---

### Update Sets

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `get_current_update_set` | `instance` | Get active update set |
| `list_update_sets` | `query`, `limit` | List with filtering |
| `create_update_set` | `name`, `description`, `application` | Create new |
| `set_current_update_set` | `name`, `sys_id` | Set as active |
| `inspect_update_set` | `sys_id` | List components grouped by type |
| `clone_update_set` | `source_sys_id`, `new_name` | Clone with all records |
| `move_update_set_records` | `target_update_set_id`, `record_sys_ids` or `source_update_set` | Move records between sets |

---

### Application Scope

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `get_current_scope` | `instance` | Get current scope |
| `set_current_scope` | `app_sys_id` | Change scope (validates and records previous) |
| `list_scoped_apps` | `query`, `limit` | List scoped applications |
| `lookup_app` | `search_term`, `type` (`all`/`app`/`plugin`) | Search apps and plugins |

---

### App Management

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `get_app_details` | `app_id` | Version, status, dependencies |
| `validate_app_install` | `packages` | Validate install requirements |
| `search_store_apps` | `tab_context`, `search_key` | Browse/search the Store |
| `list_company_apps` | `scope`, `installed_only` | Company-internal apps |
| `install_store_app` | `app_id`, `version` | Install from Store |
| `update_store_app` | `app_id`, `version` | Update installed app |
| `install_from_app_repo` | `scope`, `sys_id`, `version` | Install from company repo |
| `publish_to_app_repo` | `scope`, `sys_id`, `version` | Publish to company repo |

---

### Service Catalog

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `list_catalog_items` | `text_search`, `category_sys_id`, `active` | Browse catalog items |
| `get_catalog_item` | `sys_id`, `include_variables` | Item details with form fields |
| `list_catalog_categories` | `parent_sys_id`, `catalog_sys_id` | Browse categories |
| `get_catalog_category` | `sys_id` | Category details with item count |
| `list_catalog_item_variables` | `catalog_item_sys_id` | Form fields for a catalog item |
| `submit_catalog_request` | `catalog_item_sys_id`, `quantity`, `variables` | Place an order |

```
# Browse catalog → select item → submit request
list_catalog_items(text_search: "laptop")
get_catalog_item(sys_id: "<item-id>", include_variables: true)
submit_catalog_request(catalog_item_sys_id: "<item-id>", variables: { requested_for: "<user-id>", justification: "New hire" })
```

---

### Knowledge Management

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `list_knowledge_bases` | `query`, `active` | List knowledge bases |
| `get_knowledge_base` | `sys_id` | KB details with counts |
| `list_kb_categories` | `knowledge_base_sys_id`, `parent_category` | List categories |
| `create_kb_category` | `label`, `knowledge_base_sys_id` | Create category |
| `list_kb_articles` | `knowledge_base_sys_id`, `workflow_state`, `text_search` | List articles |
| `get_kb_article` | `sys_id` | Full article content |
| `create_kb_article` | `short_description`, `knowledge_base_sys_id`, `text` | Create (draft by default) |
| `update_kb_article` | `sys_id`, field updates | Update article |
| `publish_kb_article` | `sys_id` | Set workflow_state to published |

---

### CMDB

#### `get_cmdb_relationships`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `ci_sys_id` | string | yes | — | Configuration Item sys_id |
| `direction` | string | no | `"both"` | `"upstream"`, `"downstream"`, `"both"` |
| `relation_type` | string | no | — | Filter by relationship type |
| `limit` | number | no | `100` | Max relationships (max 1000) |

#### `traverse_cmdb_graph`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `ci_sys_id` | string | yes | — | Root CI sys_id |
| `direction` | string | no | `"both"` | Traversal direction |
| `max_depth` | number | no | `2` | Max depth (1-5) |
| `relation_type` | string | no | — | Filter to specific relationship type |
| `max_nodes` | number | no | `200` | Max nodes to visit (max 1000) |

---

### Health & Monitoring

#### `check_instance_health`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `include_version` | boolean | no | `true` | Version/build info |
| `include_cluster` | boolean | no | `true` | Cluster node status |
| `include_stuck_jobs` | boolean | no | `true` | Stuck scheduled jobs |
| `include_semaphores` | boolean | no | `true` | Active semaphore count |
| `include_operational_counts` | boolean | no | `true` | Operational counts |

---

### Workflows

#### `create_workflow`

Create a complete workflow from a single specification.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | no | env var | Auth alias |
| `name` | string | yes | — | Workflow name |
| `table` | string | yes | — | Target table |
| `description` | string | no | — | Description |
| `activities` | array | yes | — | Activity definitions |
| `transitions` | array | no | — | Transitions between activities |
| `publish` | boolean | no | `false` | Publish after creation |
| `start_activity` | string | no | — | Start activity (required when publishing) |

---

### XML Records

| Tool | Key Parameters | Description |
|------|---------------|-------------|
| `export_record_xml` | `table`, `sys_id` | Export as ServiceNow unload XML |
| `import_records_xml` | `xml_content`, `target_table` | Import XML into instance |

---

## Workflow Guides

### 1. Flow Development Lifecycle

The complete develop-test-diagnose-iterate cycle:

```
Step 1: Copy an existing flow to customize
→ copy_flow(source_flow_id: "global.change__standard", name: "My Custom Flow", target_scope: "<scope-id>")
  Returns: newFlowSysId

Step 2: Test the flow (doesn't require publishing)
→ test_flow(flow_id: "<flow-id>", output_map: { record: "INC0010042" })
  Returns: contextId

Step 3: Inspect what each action did
→ get_flow_execution_details(context_id: "<ctx>")

Step 4: Check execution logs for errors/debug info
→ get_flow_logs(context_id: "<ctx>")

Step 5: If issues found, modify the flow and go back to Step 2

Step 6: When ready, publish for production use
```

### 2. Flow Diagnostics Decision Tree

After executing a flow, use this guide to diagnose:

| I need to know... | Tool | What it returns |
|-------------------|------|-----------------|
| Did it succeed or fail? | `get_flow_context_status` | Quick state: COMPLETE, ERROR, IN_PROGRESS, etc. |
| What did each action do? | `get_flow_execution_details` | Per-action breakdown: inputs, outputs, timing, state |
| Why did it fail? | `get_flow_execution_details` then `get_flow_logs` | Details: which action failed. Logs: error messages |
| What were the outputs? | `get_flow_outputs` | Flow-level output values |
| What error message? | `get_flow_error` | Quick error lookup |
| Step-by-step debug trail | `get_flow_logs` with `order_direction: "asc"` | Chronological log entries |
| Most recent error only | `get_flow_logs` with `limit: 5, order_direction: "desc"` | Latest entries first |

**Typical diagnostic sequence:**
```
1. Quick check
→ get_flow_context_status(context_id: "<ctx>")

If ERROR:
→ get_flow_execution_details(context_id: "<ctx>")   // See which action failed
→ get_flow_logs(context_id: "<ctx>")                 // See error details

If COMPLETE:
→ get_flow_execution_details(context_id: "<ctx>")   // Verify all actions succeeded
→ get_flow_outputs(context_id: "<ctx>")              // Check output values
```

### 3. Query & Investigate

Explore a table's structure and data:

```
Step 1: Discover table schema
→ discover_table_schema(table: "incident", include_choices: true)

Step 2: Find specific columns
→ lookup_columns(table: "incident", search_term: "caller")

Step 3: Query records
→ query_table(table: "incident", query: "active=true^priority=1", fields: "number,short_description,state", limit: 10)

Step 4: Count records matching criteria
→ count_records(table: "incident", query: "active=true^priority=1")

Step 5: Group by field for breakdown
→ aggregate_grouped(table: "incident", group_by: ["priority"], count: true, query: "active=true")
```

### 4. Testing

#### ATF Tests
```
# Find tests
→ find_atf_tests(search_term: "Incident Management")

# Run a single test
→ run_atf_test(test_sys_id: "<test-id>")

# Run a test suite
→ run_atf_test_suite(suite_name: "Incident Management Tests")
```

#### Flow Testing
```
# Test → diagnose → iterate loop
→ test_flow(flow_id: "<flow-id>", output_map: { record: "INC0010042" })
→ get_flow_execution_details(context_id: "<ctx>")
→ get_flow_logs(context_id: "<ctx>")
```

### 5. Deployment

#### Update Sets
```
# Create a new update set for your changes
→ create_update_set(name: "FEAT-1234 My Feature")

# Set it as current (all changes captured here)
→ set_current_update_set(name: "FEAT-1234 My Feature", sys_id: "<us-id>")

# Make changes...

# Inspect what's in the update set
→ inspect_update_set(sys_id: "<us-id>")

# Clone for backup before deploying
→ clone_update_set(source_sys_id: "<us-id>", new_name: "FEAT-1234 Backup")
```

#### Store Apps
```
# Search for available apps
→ search_store_apps(tab_context: "available_for_you", search_key: "vulnerability")

# Check for updates
→ search_store_apps(tab_context: "updates")

# Install an app
→ install_store_app(app_id: "<id>", version: "4.2.0")

# Update an installed app
→ update_store_app(app_id: "<id>", version: "16.0.0")
```

#### Company App Repository
```
# List available company apps
→ list_company_apps()

# Install from company repo
→ install_from_app_repo(scope: "x_acme_my_app", sys_id: "<id>", version: "1.2.0")
```

### 6. Script Development

```
Step 1: Pull a script from the instance
→ pull_script(script_name: "IncidentUtils", script_type: "sys_script_include", file_path: "./scripts/IncidentUtils.js")

Step 2: Edit locally with your IDE

Step 3: Push back to instance
→ push_script(script_name: "IncidentUtils", script_type: "sys_script_include", file_path: "./scripts/IncidentUtils.js")

Step 4: Test with execute_script
→ execute_script(script: "var iu = new IncidentUtils(); gs.print(iu.someMethod());")
```

### 7. Diagnostics

```
# Full health check
→ check_instance_health()

# Query syslog for recent errors
→ query_syslog(level: "error", limit: 20)

# Search code for patterns
→ code_search(term: "getRowCount")
```

### 8. Task Management

```
# Find a task
→ find_task(table: "incident", number: "INC0010042")

# Assign it
→ assign_task(table: "incident", record_sys_id: "<id>", assigned_to: "admin", assignment_group: "<group-id>")

# Add a comment
→ add_task_comment(table: "incident", record_sys_id: "<id>", comment: "Investigating the reported issue")

# Add a work note (internal only)
→ add_task_comment(table: "incident", record_sys_id: "<id>", comment: "Root cause: DNS misconfiguration", is_work_note: true)

# Resolve
→ resolve_incident(sys_id: "<id>", resolution_notes: "Fixed DNS configuration. Service restored.")

# Close
→ close_incident(sys_id: "<id>", close_notes: "Confirmed with caller. No recurrence.")

# Approve a change
→ approve_change(sys_id: "<id>", comments: "Reviewed and approved.")
```

### 9. Knowledge Base Management

```
# Find or create a knowledge base
→ list_knowledge_bases(active: true)

# Create a category
→ create_kb_category(label: "Networking", knowledge_base_sys_id: "<kb-id>")

# Create an article
→ create_kb_article(short_description: "VPN Troubleshooting Guide", knowledge_base_sys_id: "<kb-id>", category_sys_id: "<cat-id>", text: "<p>Steps to troubleshoot VPN...</p>")

# Publish when ready
→ publish_kb_article(sys_id: "<article-id>")
```

### 10. Service Catalog

```
# Browse catalog
→ list_catalog_items(text_search: "laptop")

# Get item details with variables
→ get_catalog_item(sys_id: "<item-id>", include_variables: true)

# Submit a request
→ submit_catalog_request(catalog_item_sys_id: "<item-id>", variables: { requested_for: "<user-id>", justification: "New hire equipment" })
```

### 11. CMDB Exploration

```
# Find a CI's relationships
→ get_cmdb_relationships(ci_sys_id: "<ci-id>", direction: "downstream")

# Traverse the dependency graph
→ traverse_cmdb_graph(ci_sys_id: "<ci-id>", direction: "upstream", max_depth: 3)
```

---

## Decision Guide

### "I want to..."

| Goal | Tool | Key Parameters |
|------|------|----------------|
| Query any table | `query_table` | `table`, `query`, `fields`, `limit`, `display_value` |
| Count records | `count_records` | `table`, `query` |
| Get statistics (AVG, SUM, etc.) | `aggregate_query` | `table`, `avg_fields`, `sum_fields`, `count` |
| Group records by field | `aggregate_grouped` | `table`, `group_by`, `count`, `having` |
| Discover table structure | `discover_table_schema` | `table`, `include_choices`, `include_business_rules` |
| Explain a field | `explain_field` | `table`, `field` |
| Find a table | `lookup_table` | `search_term` |
| Find an application | `lookup_app` | `search_term`, `type` |
| Run a script | `execute_script` | `script`, `scope`, `params` |
| Test a flow (draft) | `test_flow` | `flow_id`, `output_map` |
| Run a published flow | `execute_flow` | `scoped_name`, `inputs`, `mode` |
| Check flow result | `get_flow_execution_details` | `context_id` |
| See flow errors | `get_flow_error` or `get_flow_logs` | `context_id` |
| Copy a flow | `copy_flow` | `source_flow_id`, `name`, `target_scope` |
| Run ATF tests | `run_atf_test` or `run_atf_test_suite` | `test_sys_id` or `suite_name` |
| Search code | `code_search` | `term`, `search_group` |
| Install a store app | `install_store_app` | `app_id`, `version` |
| Install from company repo | `install_from_app_repo` | `scope`, `sys_id` |
| Bulk update safely | `query_update_records` | `table`, `query`, `data`, `confirm` |
| Bulk delete safely | `query_delete_records` | `table`, `query`, `confirm` |
| Create update set | `create_update_set` | `name`, `description` |
| Export a record | `export_record_xml` | `table`, `sys_id` |
| Pull a script | `pull_script` | `script_name`, `script_type`, `file_path` |
| Push a script | `push_script` | `script_name`, `script_type`, `file_path` |
| Check instance health | `check_instance_health` | |
| Check system logs | `query_syslog` | `level`, `source`, `limit` |
| Add a task comment | `add_task_comment` | `table`, `record_sys_id`, `comment`, `is_work_note` |
| Resolve an incident | `resolve_incident` | `sys_id`, `resolution_notes` |
| Approve a change | `approve_change` | `sys_id`, `comments` |
| Submit catalog request | `submit_catalog_request` | `catalog_item_sys_id`, `variables` |
| Create KB article | `create_kb_article` | `short_description`, `knowledge_base_sys_id`, `text` |
| Explore CMDB dependencies | `traverse_cmdb_graph` | `ci_sys_id`, `direction`, `max_depth` |

---

## Safety Rules

1. **`query_update_records` and `query_delete_records` are dry-run by default.** Always run with `confirm: false` first to preview affected records, then set `confirm: true` to execute.
2. **`execute_script` runs code directly on the instance.** Prefer read-only operations unless modification is explicitly intended. Review scripts before execution.
3. **Always verify the target instance.** Double-check the `instance` parameter when working with production instances.
4. **Use update sets for configuration changes.** Create and set an update set before making customizations so changes can be tracked and migrated.
5. **Script scope matters.** The `scope` parameter in `execute_script` controls which application context the script runs in, affecting table and API access.

---

## Common Errors and Resolution

| Error | Cause | Resolution |
|-------|-------|------------|
| `No instance specified` | No `instance` parameter and no `SN_AUTH_ALIAS` env var | Pass `instance` or set `SN_AUTH_ALIAS` |
| `No credentials found for auth alias "xxx"` | Alias not configured | Run `now-sdk auth add --alias xxx --host https://...` |
| `ECONNREFUSED` | Instance unreachable | Check instance URL and network connectivity |
| `401 Unauthorized` | Invalid or expired credentials | Reconfigure: `now-sdk auth add --alias <alias>` |
| `ACL restriction` | Insufficient permissions | Ensure the authenticated user has required roles |
| `Body not XML` | Stale session or bad response | Tool auto-retries; if persistent, check instance health |

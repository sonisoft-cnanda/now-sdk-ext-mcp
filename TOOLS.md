# Available Tools

This document lists all MCP tools exposed by the `now-sdk-ext-mcp` server. When adding a new tool, document it here.

---

## Available Resources

Alongside tools, the server exposes read-only `servicenow://` resources. Use these
when you want to *attach* reference data rather than spend a tool call on it.

| URI | What |
|---|---|
| `servicenow://instances` | Aliases this server can reach, the alias used when a tool omits one, and which credential store they came from. Contains no secrets. |
| `servicenow://{alias}/scope/current` | The application scope currently selected. |
| `servicenow://{alias}/update-set/current` | The update set currently capturing changes. |
| `servicenow://{alias}/schema/{table}` | Fields, types and references for a table. |

**The alias is part of the URI and is never inferred from the environment.**
`servicenow://prod/schema/incident` is a different resource from
`servicenow://dev/schema/incident`; a resource has no `instance` argument to fall
back on, so addressing it explicitly is what keeps the two apart.

Two behaviours worth knowing:

- **`servicenow://instances` reports which store it read.** When the sn-credstore
  shim is inactive the OS keyring is authoritative and cannot be enumerated, so
  the alias list is `null` with an explanation rather than an empty array — empty
  would read as "no credentials configured", which is a different thing.
- **A failed read is a protocol error, not content.** Tools return
  `{isError: true}` so a model reasoning about a result sees the failure in-band.
  A resource is attached rather than reasoned over, so it fails at the protocol
  level and the client decides how to surface it.

Schema resources deliberately omit the expensive optional sections that
`discover_table_schema` can include — a resource is attached passively and should
not silently pull choices and business rules with it.
## Tool packages

By default every tool is registered. Set `MCP_TOOL_PACKAGE` to expose a subset
instead — model tool-selection accuracy degrades as the option count grows, and
these descriptions are long by design, so an unused tool is a cost paid on every
session.

```jsonc
// claude_desktop_config.json, or any MCP client's env block
"env": { "MCP_TOOL_PACKAGE": "service_desk" }
```

| Package | For |
|---|---|
| `full` | Everything. The default when the variable is unset. |
| `readonly` | Only tools that cannot modify anything. Derived from the `readOnlyHint` annotations, so it cannot drift. |
| `developer` | Scripts, schema, table behavior, source sync, update sets, scope, ACLs, logs, code search. |
| `service_desk` | Tickets, knowledge, catalog requests. No scripting or schema. |
| `admin` | Users and groups, ACLs, plugins, health, app lifecycle (including repair), scripting. |
| `change_manager` | Change approvals, update sets, flows and workflows (including the legacy workflow tools, and running flows and sending flow messages, which need `execute`), app repo. |
| `flow_developer` | Flow Designer end to end, plus what is needed to debug flows. |

Names can be **comma-separated**, which takes the **union**: `developer,flow_developer`.
Union rather than intersection, because combining two role packages is how you
say "I do both" — intersecting them is almost always empty.

Packages are defined in `src/config/tool-packages.ts`. Adding one needs no code
change beyond that file.

### Behaviour worth knowing

- **`list_tool_packages` is always registered**, whatever the package. Without it,
  a filtered session cannot tell "this server cannot do that" from "that tool is
  filtered out of this session" — and would report a missing capability when the
  real answer is a different package.
- **`get_policy_status` is always registered** too, for the same reason: when a tool
  is refused, it shows whether `write` and `execute` are permitted and which layer
  (for example `NEX_POLICY_DENY`) decided.
- **Every failure degrades toward MORE tools, never fewer.** An unrecognised name
  falls back to `full` and says so on stderr. A silently smaller surface would
  look like a broken server, with tools simply absent and no error to search for.
- **A package may name tools that do not exist yet.** Several name tools from open
  tickets. Unknown names are reported once at startup and skipped, so a package is
  already correct the day those tools land. The same warning catches a typo.
- Resolution is reported on stderr at startup, never stdout — stdout is the
  JSON-RPC transport.

---

## execute_script

Execute JavaScript on a ServiceNow instance using Scripts - Background.

The script runs server-side with full GlideSystem API access (`GlideRecord`, `GlideAggregate`, `gs.print()`, `gs.getUser()`, `gs.now()`, and all standard ServiceNow server-side APIs). Use `gs.print()` to produce output. Scripts execute with the permissions of the authenticated user.

> **Warning:** This executes code directly on the ServiceNow instance. Always review scripts before execution and prefer read-only operations unless modification is explicitly intended.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"myinstance"`, `"prod"`). This is the alias configured via `snc configure`. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `script` | string | **Yes** | — | The JavaScript code to execute. Use `gs.print()` to output results. |
| `scope` | string | No | `"global"` | The application scope to execute in: `"global"`, the scope of an application developed on the instance (a `sys_app`, e.g. `"x_myapp_custom"`), or a scope sys_id. Installed store apps (`sys_store_app`) are rejected before the script is sent, with a message saying what the scope is and what to do instead. |
| `params` | object | No | — | Key-value pairs for parameter substitution. Occurrences of `{paramName}` in the script are replaced with the corresponding value. |

### Example Usage

A user asking Claude:

> "Find all active incidents with priority 1 on my myinstance instance"

Would result in a tool call like:

```json
{
  "name": "execute_script",
  "arguments": {
    "instance": "myinstance",
    "script": "var gr = new GlideRecord('incident');\ngr.addQuery('active', true);\ngr.addQuery('priority', '1');\ngr.query();\nvar count = 0;\nwhile (gr.next()) {\n  gs.print(gr.number + ' - ' + gr.short_description);\n  count++;\n}\ngs.print('Total: ' + count);",
    "scope": "global"
  }
}
```

### Example with Parameter Substitution

```json
{
  "name": "execute_script",
  "arguments": {
    "instance": "myinstance",
    "script": "var gr = new GlideRecord('{table}');\ngr.addQuery('active', true);\ngr.query();\ngs.print('Count: ' + gr.getRowCount());",
    "scope": "global",
    "params": {
      "table": "incident"
    }
  }
}
```

---

## run_atf_test

Execute a single ServiceNow ATF (Automated Test Framework) test by its sys_id. The test runs on the instance and the tool waits for it to complete before returning the result. Returns the test name, status (success/failure), run time, and any output produced by the test.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"myinstance"`, `"prod"`). If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `test_sys_id` | string | **Yes** | — | The sys_id of the ATF test to execute (from the `sys_atf_test` table). |

### Example Usage

A user asking Claude:

> "Run the ATF test with sys_id abc123def on my myinstance instance"

Would result in a tool call like:

```json
{
  "name": "run_atf_test",
  "arguments": {
    "instance": "myinstance",
    "test_sys_id": "abc123def456789"
  }
}
```

### Example Output

```
=== Test Execution Results ===
Test Name: Validate Incident Creation
Status: success
Run Time: 00:00:12
Test Sys ID: abc123def456789
Result Sys ID: result987654321

--- Output ---
All steps passed

=== Execution Complete ===
```

---

## run_atf_test_suite

Execute a ServiceNow ATF test suite and wait for all tests to complete. Identify the suite by either its name or sys_id (provide exactly one). Returns a summary with pass/fail/skip/error counts and overall status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `suite_name` | string | No* | — | The name of the test suite to execute. Provide either `suite_name` or `suite_sys_id`, but not both. |
| `suite_sys_id` | string | No* | — | The sys_id of the test suite to execute. Provide either `suite_name` or `suite_sys_id`, but not both. |
| `browser_name` | string | No | — | Browser to use for UI tests (e.g., `"Chrome"`, `"Firefox"`). |
| `browser_version` | string | No | — | Browser version for UI tests. |
| `os_name` | string | No | — | Operating system for UI tests (e.g., `"Windows"`, `"Mac"`). |
| `os_version` | string | No | — | OS version for UI tests. |
| `is_performance_run` | boolean | No | — | Whether to run as a performance test. |
| `run_in_cloud` | boolean | No | — | Whether to run tests in the cloud runner. |

\* You must provide either `suite_name` or `suite_sys_id`.

### Example Usage

By suite name:

```json
{
  "name": "run_atf_test_suite",
  "arguments": {
    "instance": "myinstance",
    "suite_name": "Incident Management Tests"
  }
}
```

By sys_id with browser options:

```json
{
  "name": "run_atf_test_suite",
  "arguments": {
    "suite_sys_id": "abc123def456789",
    "browser_name": "Chrome",
    "run_in_cloud": true
  }
}
```

### Example Output

```
=== Test Suite Execution Results ===
Test Suite: Incident Management Tests
Status: success
Success: true
Run Time: 00:05:00
Start Time: 2024-01-15 10:00:00
End Time: 2024-01-15 10:05:00

--- Test Summary ---
Total Tests: 12
Passed: 10
Failed: 0
Skipped: 2
Errors: 0

=== Execution Complete ===

All tests passed!
```

---

## query_table

Query any ServiceNow table using the Table API. Returns records matching the specified criteria. Supports encoded query strings, field selection, and display value resolution.

Use this for general-purpose data retrieval from any table (incident, sys_user, cmdb_ci, change_request, etc.).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | The ServiceNow table name to query (e.g., `"incident"`, `"sys_user"`, `"cmdb_ci_server"`). |
| `query` | string | No | — | A ServiceNow encoded query string to filter records (e.g., `"active=true^priority=1"`). |
| `fields` | string | No | all fields | Comma-separated list of field names to return (e.g., `"sys_id,number,short_description"`). |
| `limit` | number | No | `20` | Maximum number of records to return (1-1000). |
| `display_value` | boolean | No | `false` | When true, returns display values instead of internal values for reference and choice fields. |

### Example Usage

```json
{
  "name": "query_table",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "query": "active=true^priority=1",
    "fields": "sys_id,number,short_description,state,assigned_to",
    "limit": 10,
    "display_value": true
  }
}
```

### Example Output

```
=== Query Results ===
Table: incident
Query: active=true^priority=1
Fields: sys_id,number,short_description,state,assigned_to
Records returned: 2

--- Record 1 ---
{
  "sys_id": "abc123",
  "number": "INC0010042",
  "short_description": "Network outage in building 4",
  "state": "In Progress",
  "assigned_to": "John Smith"
}

--- Record 2 ---
{
  "sys_id": "def456",
  "number": "INC0010043",
  "short_description": "Email server not responding",
  "state": "New",
  "assigned_to": ""
}

=== 2 record(s) returned ===
```

---

## find_atf_tests

Search for ATF (Automated Test Framework) tests on a ServiceNow instance. Find tests by name, description, or category. Returns a list of matching tests with their sys_ids, which can then be passed to the `run_atf_test` tool for execution.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `search_term` | string | No | — | Text to search for in test name and description (case-insensitive contains). |
| `category` | string | No | — | Filter by test category (e.g., `"Custom"`, `"Module"`). |
| `active` | boolean | No | `true` | Filter by active status. Defaults to true (only active tests). |
| `limit` | number | No | `25` | Maximum number of tests to return (1-100). |

### Example Usage

```json
{
  "name": "find_atf_tests",
  "arguments": {
    "instance": "myinstance",
    "search_term": "incident",
    "active": true
  }
}
```

### Example Output

```
=== ATF Test Search Results ===
Search: "incident" | Active: true
Found: 3 test(s)

1. Validate Incident Creation
   sys_id: abc123def456789
   Active: true
   Description: Tests that new incidents are created with the correct default values and assignment...

2. Incident Priority Escalation
   sys_id: def789abc012345
   Active: true
   Description: Verifies that high-priority incidents are automatically escalated to the correct...

3. Close Incident Workflow
   sys_id: ghi012def345678
   Active: true
   Description: Tests the full incident closure workflow including resolution validation...

=== 3 test(s) found ===

Tip: Use the sys_id with the run_atf_test tool to execute a test.
```

---

## query_syslog

Query the ServiceNow system log (syslog) to check for errors, warnings, and debug output. Returns log entries with timestamps, levels, sources, and messages. Results are ordered newest-first.

Useful for monitoring script execution results, checking for errors after deployments, and debugging issues. Can be called repeatedly to check for new entries.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `query` | string | No | — | A ServiceNow encoded query string for additional filtering (e.g., `"messageLIKEscript error"`). |
| `level` | string | No | — | Filter by log level: `"error"`, `"warning"`, `"info"`, or `"debug"`. |
| `source` | string | No | — | Filter by log source (e.g., `"sys_script"`, `"workflow"`). Exact match. |
| `limit` | number | No | `50` | Maximum number of entries to return (1-500). |
| `table` | string | No | `"syslog"` | Which syslog table: `"syslog"` for system logs, `"syslog_app_scope"` for scoped app logs. |

### Example Usage

Check for recent errors:

```json
{
  "name": "query_syslog",
  "arguments": {
    "instance": "myinstance",
    "level": "error",
    "limit": 20
  }
}
```

Filter by source and custom query:

```json
{
  "name": "query_syslog",
  "arguments": {
    "source": "sys_script",
    "query": "messageLIKEtimeout",
    "table": "syslog_app_scope"
  }
}
```

### Example Output

```
=== Syslog Query Results ===
Table: syslog | Level: error | Records: 3

[2024-01-15 10:23:45] ERROR | sys_script | Script error in incident_before_insert: TypeError: Cannot read property 'getValue' of null
[2024-01-15 10:22:31] ERROR | workflow | Workflow 'Incident Assignment' failed at activity 'Assign to Group': No matching group found
[2024-01-15 10:21:17] ERROR | sys_script | Script error in change_request_after: ReferenceError: undefined variable 'grChange'

=== 3 entries returned ===
```

---

## lookup_app

Search for ServiceNow applications (scoped apps) and platform plugins by name, scope namespace, or plugin ID. Returns sys_id, name, scope, version, active status, and type for each match.

ServiceNow uses a hierarchical table structure for packages:
- **sys_scope**: All scoped applications (base table)
  - **sys_app**: Custom applications in development on this instance
  - **sys_store_app**: Applications installed from the ServiceNow Store or company app repo
- **sys_plugins**: Platform plugins

Key use cases:
- Find an application's sys_id to pass as the `scope` parameter to `execute_script` (to run scripts within that application's scope)
- Check whether a specific app or plugin is installed/active on the instance
- Look up version, scope namespace, and vendor info for any application or plugin

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `search_term` | string | **Yes** | — | Name, scope namespace (e.g., `"x_acme_my_app"`, `"sn_vul"`), or plugin ID (e.g., `"com.snc.vulnerability_response"`) to search for. Case-insensitive partial matching (contains). |
| `type` | string | No | `"all"` | Filter search scope: `"app"` for scoped applications only, `"plugin"` for platform plugins only, `"all"` for both. |
| `active_only` | boolean | No | `false` | When true, only returns active/installed applications and plugins. |

### Example Usage

```json
{
  "name": "lookup_app",
  "arguments": {
    "instance": "myinstance",
    "search_term": "vulnerability",
    "type": "all",
    "active_only": true
  }
}
```

### Example Output

```
=== Application & Plugin Search Results ===
Search: "vulnerability" | Type: all | Active only: yes
Found: 3 result(s)

--- Applications (1) ---

1. Vulnerability Response
   sys_id: abc123def456789
   Scope: sn_vul
   Version: 15.0.0
   Type: Store App
   Active: true
   Vendor: ServiceNow
   Description: Vulnerability Response helps you prioritize and remediate...

--- Plugins (2) ---

1. Vulnerability Response
   sys_id: def456abc789012
   Plugin ID: com.snc.vulnerability_response
   Version: 15.0.0
   Active: true

2. Vulnerability Response - Connector Support
   sys_id: ghi789def012345
   Plugin ID: com.snc.vulnerability_response.connectors
   Version: 15.0.0
   Active: true

=== 3 result(s) found ===

Tip: Use an application's sys_id as the `scope` parameter in execute_script to run scripts within that application's scope.
```

---

## lookup_table

Search for ServiceNow tables by name or label. Queries the `sys_db_object` table to find and validate table names.

Use this tool to:
- Verify a table name exists before using it with `query_table` or in GlideRecord scripts
- Discover the correct internal name for a table when you only know the display label
- Find related tables (e.g., search `"incident"` to see incident, incident_task, etc.)
- Check table hierarchy (which table a table extends)

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `search_term` | string | **Yes** | — | Table name or label to search for. Case-insensitive partial matching (contains). Examples: `"incident"`, `"cmdb_ci"`, `"Change Request"`. |
| `limit` | number | No | `25` | Maximum number of results to return (1-100). |

### Example Usage

```json
{
  "name": "lookup_table",
  "arguments": {
    "instance": "myinstance",
    "search_term": "incident",
    "limit": 5
  }
}
```

### Example Output

```
=== Table Search Results ===
Search: "incident"
Found: 3 table(s)

1. incident (Incident)
   sys_id: b4211c11795632108bb291bde809c9e5
   Extends: Task
   Extendable: false
   Number prefix: INC
   Scope: Global

2. incident_fact_table (Incident Fact Table)
   sys_id: 0c7b0411791232108bb291bde809c915
   Extendable: false
   Scope: Global

3. incident_task (Incident Task)
   sys_id: f4211c11795632108bb291bde809c953
   Extends: Task
   Extendable: false
   Scope: Global

Tip: Use the table name (not label) with query_table or in GlideRecord scripts. Use lookup_columns to see the columns available on a table.
```

---

## lookup_columns

List or search columns (fields) on a ServiceNow table. Queries the `sys_dictionary` table to find column names, types, and metadata for a given table.

Use this tool to:
- List all columns on a table to see what fields are available
- Validate a column name before using it in a query or script
- Find the correct internal element name when you only know the display label
- Check column types, whether a field is mandatory, read-only, or a reference

> **Note:** Only columns defined directly on the specified table are returned. Inherited columns (e.g., `priority` on `incident`, which is defined on `task`) are not included. Query the parent table to see inherited fields.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | The internal table name to look up columns for (e.g., `"incident"`, `"cmdb_ci_server"`, `"sys_user"`). Use `lookup_table` first if you are unsure of the exact table name. |
| `search_term` | string | No | — | Optional filter to search columns by element name or label. Case-insensitive partial matching. If omitted, returns all columns on the table. |
| `limit` | number | No | `50` | Maximum number of columns to return (1-200). |

### Example Usage

List all columns:

```json
{
  "name": "lookup_columns",
  "arguments": {
    "instance": "myinstance",
    "table": "incident"
  }
}
```

Search for specific columns:

```json
{
  "name": "lookup_columns",
  "arguments": {
    "table": "incident",
    "search_term": "caller",
    "limit": 10
  }
}
```

### Example Output

```
=== Columns for table: incident ===
Found: 5 column(s)

1. business_impact (Business impact)
   Type: String
   Mandatory: false | Read-only: false | Active: true
   Max length: 4,000

2. business_stc (Business resolve time)
   Type: Integer
   Mandatory: false | Read-only: true | Active: true
   Max length: 40

3. caller_id (Caller)
   Type: Reference -> User
   Mandatory: false | Read-only: false | Active: true
   Max length: 32
   Default: javascript:incidentGetCaller();

4. category (Category)
   Type: String
   Mandatory: false | Read-only: false | Active: true
   Max length: 40
   Default: inquiry

5. cause (Cause)
   Type: String
   Mandatory: false | Read-only: false | Active: true
   Max length: 4,000

Tip: Use column element names (left of parentheses) in encoded queries, GlideRecord scripts, and the fields parameter of query_table.
```

---

## code_search

Search for code across a ServiceNow instance using the Code Search API. Finds matching scripts, business rules, script includes, and other code artifacts across the platform. Results include the record name, table, field, and matching line numbers with context.

Code Search works through **Search Groups**, which define sets of tables and fields to search. There is typically a default search group. Use `list_code_search_groups` to discover available groups, and `list_code_search_tables` to see which tables a group covers.

Key use cases:
- Find scripts that reference a specific API, table, or pattern
- Locate business rules, script includes, or UI scripts containing specific logic
- Verify whether code has been deployed to an instance
- Search within a specific application scope or table

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"myinstance"`, `"prod"`). If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `term` | string | **Yes** | — | The search term to find in code. Searches across script fields in the tables defined by the search group. |
| `search_group` | string | No | instance default | The search group NAME to scope the search (e.g., `"Default Code Search Group"`). Use `list_code_search_groups` to discover available groups. |
| `table` | string | No | — | Specific table to search within (e.g., `"sys_script_include"`). Requires `search_group` to also be specified. Use `list_code_search_tables` to see available tables. |
| `current_app` | string | No | — | Application scope to limit results to (e.g., `"x_myapp"`). When set, `search_all_scopes` is automatically set to false. |
| `search_all_scopes` | boolean | No | `true` | When false, limits results to files within the scope specified by `current_app`. |
| `limit` | number | No | — | Maximum number of results to return. |

### Example Usage

Search for all references to GlideRecord:

```json
{
  "name": "code_search",
  "arguments": {
    "instance": "myinstance",
    "term": "GlideRecord"
  }
}
```

Search within a specific search group and table:

```json
{
  "name": "code_search",
  "arguments": {
    "instance": "myinstance",
    "term": "addQuery",
    "search_group": "Default Code Search Group",
    "table": "sys_script_include",
    "limit": 10
  }
}
```

Search within a specific application scope:

```json
{
  "name": "code_search",
  "arguments": {
    "term": "validateInput",
    "current_app": "x_myapp_custom"
  }
}
```

### Example Output

```
=== Code Search Results ===
Search: "GlideRecord" | Limit: 5

Found 3 matches:

  Script Include > IncidentUtils > Script
    Table: sys_script_include, Field: script, Matches: 2
      L10: var gr = new GlideRecord("incident");
      L25: var gr2 = new GlideRecord("task");

  Business Rule > Auto-assign incidents > Script
    Table: sys_script, Field: script, Matches: 1
      L5: var gr = new GlideRecord("sys_user_group");

  UI Script > form_helpers > Script
    Table: sys_ui_script, Field: script, Matches: 1
      L42: var gr = new GlideRecord("sys_choice");

Tip: Use `list_code_search_groups` to discover available search groups, then pass the group name as `search_group` to scope your search.
```

---

## list_code_search_groups

List available code search groups on a ServiceNow instance. Search groups define which tables and fields are included when performing a code search. Each instance typically has a default search group, and additional groups can be created for specific use cases.

Use the group `name` as the `search_group` parameter in `code_search`. Use the group `sys_id` when adding tables via `add_code_search_table`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `limit` | number | No | `100` | Maximum number of search groups to return. |

### Example Usage

```json
{
  "name": "list_code_search_groups",
  "arguments": {
    "instance": "myinstance"
  }
}
```

### Example Output

```
=== Code Search Groups ===
Found: 2 group(s)

1. Default Code Search Group
   sys_id: abc123def456789012345678abcdef01
   Description: The default code search group

2. Custom Scripts Group
   sys_id: def456abc789012345678901abcdef02
   Description: Custom group for application-specific scripts

=== 2 group(s) found ===

Tip: Use the group name as `search_group` in `code_search`. Use the sys_id as `search_group` in `add_code_search_table`.
```

---

## list_code_search_tables

List the tables associated with a code search group. These are the tables and fields that are searched when performing a code search with that group.

Use this to understand what a search group covers, or to identify if a specific table is missing and needs to be added via `add_code_search_table`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `search_group` | string | **Yes** | — | The search group NAME (not sys_id). Use `list_code_search_groups` to find available group names. |

### Example Usage

```json
{
  "name": "list_code_search_tables",
  "arguments": {
    "instance": "myinstance",
    "search_group": "Default Code Search Group"
  }
}
```

### Example Output

```
=== Tables in Search Group: Default Code Search Group ===
Found: 5 table(s)

1. sys_script_include (Script Include)
2. sys_script (Business Rule)
3. sys_ui_script (UI Script)
4. sys_ui_action (UI Action)
5. sys_ws_operation (Scripted REST Resource)

=== 5 table(s) found ===

Tip: Use `add_code_search_table` to add a table to this search group, or pass a table name as `table` in `code_search` to search a specific table.
```

---

## add_code_search_table

Add a new table to an existing code search group, expanding what gets searched. After adding a table, code searches using that group will also search the specified fields on the new table.

Requires the search group's sys_id (get it from `list_code_search_groups`) and the table name and fields to search.

> **Warning:** This modifies the code search configuration on the instance. Verify the table name and fields before adding.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | The table name to add (e.g., `"sys_script_include"`, `"sys_ui_script"`). Use `lookup_table` to verify the table name exists. |
| `search_fields` | string | **Yes** | — | Comma-separated field names to search on this table (e.g., `"script,name"`). Use `lookup_columns` to find available fields. |
| `search_group` | string | **Yes** | — | The sys_id of the target code search group. Get this from `list_code_search_groups`. |

### Example Usage

```json
{
  "name": "add_code_search_table",
  "arguments": {
    "instance": "myinstance",
    "table": "sys_ui_action",
    "search_fields": "script,condition",
    "search_group": "abc123def456789012345678abcdef01"
  }
}
```

### Example Output

```
=== Code Search Table Added ===

Table: sys_ui_action
Search Fields: script,condition
sys_id: new123record456789
Search Group: abc123def456789012345678abcdef01

The table has been added to the search group. Code searches using this group will now include results from this table.
```

---

## discover_table_schema

Discover the full schema of a ServiceNow table including all fields, types, references, and optionally choice values, relationships, UI policies, and business rules. Returns the table name, label, parent class, and for each field: name, label, type, max length, mandatory, read-only, reference table, and default value.

Key use cases:
- Understand table structure before querying or scripting
- Discover reference fields and their target tables
- Find choice values for dropdown fields
- Review UI policies and business rules defined on a table

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name to discover (e.g., `"incident"`, `"sys_user"`, `"cmdb_ci"`). |
| `include_choices` | boolean | No | `false` | Include choice values for fields (queries `sys_choice`). |
| `include_relationships` | boolean | No | `false` | Include relationship information extracted from reference fields. |
| `include_ui_policies` | boolean | No | `false` | Include UI policies defined on the table. |
| `include_business_rules` | boolean | No | `false` | Include business rules defined on the table. |

### Example Usage

```json
{
  "name": "discover_table_schema",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "include_choices": true,
    "include_relationships": true
  }
}
```

### Example Output

```
=== Table Schema: incident ===
Label: Incident
Parent: task

--- Fields (5) ---

1. cause (Cause)
   Type: string | Max Length: 4000
   Mandatory: false | Read-only: false
   Default: —

2. caller_id (Caller)
   Type: reference | Max Length: 32
   Mandatory: false | Read-only: false
   Reference: sys_user

...

--- Choice Values ---

state:
  1 = New
  2 = In Progress
  3 = On Hold
  6 = Resolved
  7 = Closed

--- Relationships ---

caller_id -> sys_user (reference)
assignment_group -> sys_user_group (reference)
```

---

## discover_table_behavior

Read configuration affecting a table: business rules, UI actions, client scripts, UI policies and field actions, server data policies, legacy workflows, record-triggered flows and generic state models. Complements `discover_table_schema` with conditions, timing, applicability, provenance and optional artifact details. Available in `full`, `readonly`, `developer`, and `flow_developer`.

### Parameters

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `instance` | string | No | `SN_AUTH_ALIAS` | Instance credential alias |
| `table` | string | **Yes** | — | Target table, e.g. `change_request` |
| `categories` | string[] | No | All eight | Nonempty selection of `business_rules`, `ui_actions`, `client_scripts`, `ui_policies`, `data_policies`, `workflows`, `flows`, `state_models` |
| `include_inherited` | boolean | No | `true` | Include applicable ancestor behavior |
| `include_inactive` | boolean | No | `false` | Include inactive/draft candidates where discoverable |
| `name` | string | No | — | Metadata name contains this text; maximum 128 characters, no caret or newline |
| `sys_ids` | string[] | No | — | Up to 50 metadata source IDs, each 32 hexadecimal characters; for known flow IDs use `get_behavior_details` |
| `limit` | integer | No | `50` | Items per category, 1–200 |
| `cursors` | object | No | — | Category-to-`nextCursor` map; retain the original table, filters and detail selection |
| `details` | string[] | No | Compact summaries | Include any of `scripts`, `definitions`, `dependencies` in this call |
| `dependency_depth` | integer | No | `0` | 0 or 1; 1 requires `dependencies` and expands at most 50 unique references |
| `max_bytes` | integer | No | `65536` | JSON response budget, 4,096–1,048,576 bytes |
| `scope` | string | No | — | Transaction scope for flow definition reads |

### Example Usage

```json
{
  "name": "discover_table_behavior",
  "arguments": {
    "instance": "dev",
    "table": "change_request",
    "categories": ["business_rules", "flows", "state_models"],
    "details": ["scripts", "definitions", "dependencies"],
    "dependency_depth": 1,
    "max_bytes": 262144
  }
}
```

### Output and Continuation

`structuredContent` contains `table`, `ancestors`, `requestedDetails`, `categories`, `dependencies`, `warnings`, and `visibility: "accessible_configuration"`. Each category has `status` (`complete`, `partial`, `unavailable`, or `failed`), `items`, `warnings`, and optional `nextCursor`. Items retain source references, configuration, available script-field names, requested details and omissions. The text content summarizes counts and incomplete reads.

Pass returned cursors in `cursors` with unchanged filters, even after an empty designer-scan page. Oversized detail is omitted whole with warnings and recovery references; use a larger budget or targeted retrieval. Missing permissions, plugins or fields affect completeness. Conditions are not evaluated. Runtime trigger metadata and current design definitions are labeled separately and can differ. See [behavior guidance](README.md#table-behavior-discovery) for ATF usage and [core details](https://github.com/sonisoft-cnanda/now-sdk-ext-core/blob/main/docs/TableBehaviorDiscovery.md) for source layouts and limits.

---

## get_behavior_details

Read 1–50 known behavior references without repeating table discovery. Accept references directly from `discover_table_behavior`, or known IDs with an allowed kind/source-table pair. Read-only; available in `full`, `readonly`, `developer`, and `flow_developer`.

### Parameters

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `instance` | string | No | `SN_AUTH_ALIAS` | Instance credential alias |
| `references` | object[] | **Yes** | — | 1–50 objects with `kind`, `sourceTable`, and `sysId`; reference keys use camelCase |
| `details` | string[] | No | Compact summaries | Any of `scripts`, `definitions`, `dependencies` |
| `dependency_depth` | integer | No | `0` | 0 or 1; 1 requires `dependencies` and expands at most 50 unique references |
| `max_bytes` | integer | No | `65536` | JSON response budget, 4,096–1,048,576 bytes |
| `scope` | string | No | — | Transaction scope for flow definition reads |

`kind` accepts the eight discovery categories plus `subflow`, `action`, `script_include`, and `decision_table`. `sysId` must be 32 hexadecimal characters. Core validates kind/source-table pairs; known flows use `flows` with `sys_hub_flow`. Discovery flow references may instead identify trigger records, so preserve returned references unchanged.

### Example Usage

Replace the example sys_id with a flow ID from your instance:

```json
{
  "name": "get_behavior_details",
  "arguments": {
    "instance": "dev",
    "references": [
      {
        "kind": "flows",
        "sourceTable": "sys_hub_flow",
        "sysId": "0123456789abcdef0123456789abcdef"
      }
    ],
    "details": ["definitions", "dependencies"],
    "dependency_depth": 1,
    "max_bytes": 262144
  }
}
```

### Output and Recovery

`structuredContent` contains `items`, `dependencies`, `warnings`, `remainingReferences`, `requestedDetails`, and `visibility: "accessible_configuration"`. Items preserve canonical references, configuration and optional details. Inaccessible or oversized details include warnings and recovery information. Retry `remainingReferences` or item references with a larger budget or smaller batch; inspect `omittedDetails` before using a result as complete. Scripts are never truncated mid-body. Dynamic dependencies may remain unresolved; explicit and inferred references retain evidence and snapshot provenance when available.

---

## explain_field

Get a detailed explanation of a specific field on a ServiceNow table, including type, constraints, help text, and available choice values. Use this to understand what a field does, what values it accepts, and how it is configured before reading or writing data.

> **Note:** Only fields defined directly on the specified table are returned. Inherited fields (e.g., `priority` on `incident`, which is defined on `task`) require querying the parent table.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name containing the field (e.g., `"incident"`, `"sys_user"`). |
| `field` | string | **Yes** | — | Field element name to explain (e.g., `"state"`, `"priority"`, `"assigned_to"`). |

### Example Usage

```json
{
  "name": "explain_field",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "field": "cause"
  }
}
```

### Example Output

```
=== Field Explanation ===
Field: cause
Table: incident
Label: Cause
Type: string
Max Length: 4000
Mandatory: false
Read-only: false
Comments: —
Help: —
```

---

## validate_catalog

Validate a catalog item's configuration on a ServiceNow instance. Checks variables for duplicates, missing names, inactive mandatory variables, and UI policy issues. Returns a valid/invalid flag, error and warning counts, and each issue with its severity, component, sys_id, description, and suggested fix.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `catalog_item_sys_id` | string | **Yes** | — | The sys_id of the catalog item to validate. |

### Example Usage

```json
{
  "name": "validate_catalog",
  "arguments": {
    "instance": "myinstance",
    "catalog_item_sys_id": "abc123def456789"
  }
}
```

### Example Output

```
=== Catalog Validation Results ===
Catalog Item: abc123def456789
Valid: false
Errors: 1 | Warnings: 2

[ERROR] Duplicate variable name "requester_email"
  Component: Variable | sys_id: var123
  Fix: Rename one of the duplicate variables to have a unique name.

[WARNING] Inactive mandatory variable "justification"
  Component: Variable | sys_id: var456
  Fix: Either activate the variable or remove the mandatory constraint.

=== 3 issue(s): 1 error(s), 2 warning(s) ===
```

---

## get_current_scope

Get the currently active application scope on the ServiceNow instance. Returns the application name, sys_id, scope namespace, version, and active status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |

### Example Usage

```json
{
  "name": "get_current_scope",
  "arguments": {
    "instance": "myinstance"
  }
}
```

### Example Output

```
=== Current Application Scope ===
Name: Global
Sys ID: global
Scope: global
Version: —
Active: true
```

---

## set_current_scope

Change the active application scope on the ServiceNow instance. Validates the target application exists, records the previous scope, and verifies the change succeeded.

> **Warning:** This changes the session's application context. All subsequent operations (script execution, record creation, etc.) will run within the new scope.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `app_sys_id` | string | **Yes** | — | The sys_id of the application to set as the current scope (32-character hex string). Use `list_scoped_apps` or `lookup_app` to find the sys_id. |

### Example Usage

```json
{
  "name": "set_current_scope",
  "arguments": {
    "instance": "myinstance",
    "app_sys_id": "abc123def456789012345678abcdef01"
  }
}
```

### Example Output

```
=== Scope Changed ===
Success: true
Application: My Custom App
Scope: x_acme_my_app
Sys ID: abc123def456789012345678abcdef01
Verified: true

Previous Scope: Global (global)
```

---

## list_scoped_apps

List scoped applications (`sys_app` records) on the instance with optional filtering. Returns application name, sys_id, scope namespace, version, and active status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `query` | string | No | — | Encoded query string to filter applications (e.g., `"active=true^scopeSTARTSWITHx_"`). If omitted, all applications are returned. |
| `limit` | number | No | `50` | Maximum number of applications to return (1-200). |

### Example Usage

```json
{
  "name": "list_scoped_apps",
  "arguments": {
    "instance": "myinstance",
    "query": "active=true",
    "limit": 10
  }
}
```

### Example Output

```
=== Scoped Applications ===
Found: 3 application(s)

1. My Custom App
   Sys ID: abc123def456789012345678abcdef01
   Scope: x_acme_my_app
   Version: 1.0.0
   Active: true

2. HR Service Delivery
   Sys ID: def456abc789012345678901abcdef02
   Scope: sn_hr_sp
   Version: 4.5.0
   Active: true

...
```

---

## get_current_update_set

Get the currently active update set for the session. Returns the update set name, sys_id, state, description, and associated application.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |

### Example Usage

```json
{
  "name": "get_current_update_set",
  "arguments": {
    "instance": "myinstance"
  }
}
```

### Example Output

```
=== Current Update Set ===
Name: Default [Global] [abc123]
sys_id: abc123def456789
State: in progress
Description: Default update set
Application: Global
```

---

## list_update_sets

List update sets on the instance with optional filtering. Returns update set name, sys_id, state, description, and creation details.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `query` | string | No | — | Encoded query string for filtering (e.g., `"state=in progress"`, `"application=global"`). |
| `limit` | number | No | `50` | Maximum number of update sets to return (1-500). |
| `fields` | string | No | — | Comma-separated list of fields to return (e.g., `"sys_id,name,state,description"`). |

### Example Usage

```json
{
  "name": "list_update_sets",
  "arguments": {
    "instance": "myinstance",
    "query": "state=in progress",
    "limit": 10
  }
}
```

### Example Output

```
=== Update Sets ===
Found 3 update set(s):

1. Default [Global]
   sys_id: abc123def456789
   State: in progress
   Description: Default update set
   Created: 2024-01-01 | By: admin

2. My Feature Update Set
   sys_id: def456abc789012
   State: in progress
   Description: Changes for new feature
   Created: 2024-01-10 | By: admin

...
```

---

## create_update_set

Create a new update set on the ServiceNow instance.

> **Warning:** This creates a new update set on the instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `name` | string | **Yes** | — | Name of the update set to create. |
| `description` | string | No | — | Optional description for the update set. |
| `application` | string | **Yes** | — | `global`, a sys_scope sys_id, or a scope name matching exactly one active application. The set is checked for a duplicate name there and read back. Required since 5.0: before, it was optional and an omitted application took an unchecked path into the user's current application. |

### Example Usage

```json
{
  "name": "create_update_set",
  "arguments": {
    "instance": "myinstance",
    "name": "FEAT-1234 New Catalog Item",
    "application": "global",
    "description": "Update set for the new hardware catalog item"
  }
}
```

### Example Output

```
Update set created successfully.

sys_id: 3cc9f203531c9f90b6d61901a0490ed4
Name: FEAT-1234 New Catalog Item
State: in progress
Application: global

Make it the working set with set_current_update_set before changing anything.
```

---

## set_current_update_set

Make an In progress, non-Default update set the user's **working set**, as `nex update-set use` does. It saves the application (`apps.current_app`) and the update set for every later session, then reads both back. The result reports the previous working set: put it back with `restore_update_set` when the work is done.

> **Warning:** This changes what captures the user's own later changes, in the UI and elsewhere. Needs `execute` as well as `write`: the preferences are saved by a background script.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the In progress, non-Default update set. |
| `name` | string | No | — | Deprecated and ignored; the name is read back. |

### Example Output

```
Working set changed (read back): FEAT-1234 New Catalog Item (3cc9f203531c9f90b6d61901a0490ed4); state: in progress; application: 921fd9af4c554457a73ad246c71a17f7
Previous working set: application global, update set 9055f6338c9503100a22deb6dd2b4ead
Restore it with restore_update_set (application, update_set) when the work is done.
```

---

## restore_update_set

Put back the working set that `set_current_update_set` reported as previous. If that set has closed meanwhile, the application's Default set becomes current instead, and the result says so.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `application` | string | **Yes** | — | `previous.application`: `global`, a sys_scope sys_id, or `""` when none was saved. |
| `update_set` | string | **Yes** | — | `previous.updateSet`: a sys_id, or `""` when none was saved. |

When `set_current_update_set` reported "none saved", restore with `{"application": "", "update_set": ""}`: the user goes back to the platform default (Global and its Default set).

---

## complete_update_set

Complete an In progress, non-Default update set after checking what it holds: the capture count must equal `expected_captures`, no other user may be working in it, and every capture must belong to the set's application. The state is read back.

> **Warning:** A Complete set should not be reopened once another instance retrieved it or it was exported. Complete when the work is done and reviewed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The set to complete. |
| `expected_captures` | integer | **Yes** | — | The number of captures you reviewed (e.g. with `inspect_update_set`). |

---

## move_update_set_capture

Move one capture (`sys_update_xml`) to another In progress, non-Default set of its own application, and read it back. Refused when a newer capture of the same record exists elsewhere, when the target already holds one, or across applications. Prefer this to `move_update_set_records`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `capture` | string | **Yes** | — | The `sys_update_xml` sys_id. |
| `source_set` | string | **Yes** | — | The set it is in now. |
| `target_set` | string | **Yes** | — | The set to move it to. |
| `reason` | string | **Yes** | — | Why it moves; letters, digits and simple punctuation. Appended to the capture's comments. |

---

## export_update_set

Export an update set to an XML file on the machine running the server, as the platform's Export to XML does. That covers a Complete local set, a batch base with its Complete children, or a Retrieved (Loaded) set. The file is checked against the set's records before it is written. A local export's temporary Retrieved Update Set copy is removed, and its removal is read back.

> **Warning:** The XML holds every record's full payload. It is written to the file only (mode 0600) and never returned to the model. Export from a customer instance only with the user's say-so. Needs `execute` and `write`, because the platform's export copies the set through a background script.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | A `sys_update_set` or `sys_remote_update_set` sys_id. |
| `output` | string | **Yes** | — | Absolute path ending in `.xml`, inside `NEX_EXPORT_DIR` when the server sets it. |
| `replace` | boolean | No | `false` | Replace an existing regular file, or a link (the link itself, never its target). Only when `NEX_EXPORT_DIR` is set: without it, an export can only create a new file. |
| `include_incomplete` | boolean | No | `false` | Export a set that is not Complete, as a snapshot. |

### Example Output

```
Exported an update set (local) to /work/exports/feat-1234.xml (48211 bytes).
Update set: FEAT-1234 New Catalog Item (3cc9...); state: complete
Records: 12
- FEAT-1234 New Catalog Item (3cc9...); complete; 12 record(s)
Temporary copy 8f2a... removed by platform (read back).
```

---

## inspect_update_set

Inspect an update set's contents — lists all components (records) captured in the update set, grouped by type (business rules, script includes, UI policies, etc.).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the update set to inspect. |

### Example Usage

```json
{
  "name": "inspect_update_set",
  "arguments": {
    "instance": "myinstance",
    "sys_id": "abc123def456789"
  }
}
```

### Example Output

```
=== Update Set: FEAT-1234 New Catalog Item ===
sys_id: abc123def456789
State: in progress
Description: Update set for the new hardware catalog item
Total Records: 5

--- Business Rule (2) ---
  Auto-assign incidents
  Validate priority field

--- Script Include (2) ---
  IncidentUtils
  PriorityHelper

--- UI Policy (1) ---
  Hide resolution fields when not resolved
```

---

## repair_store_app

Repair an installed Store or company application, as the platform's Repair Application does. It reinstalls the installed version from the application repository without uninstalling it, and waits for the result while reporting progress. Files customized on the instance are kept and listed as skipped. Trust only a result that says **Repaired**: that requires the tracker to succeed and a new upgrade history to be written and finished. Anything else (not confirmed, still running, failed) comes back as an error, as `nex store repair` exits non-zero for it. If waiting fails after the repair started, the error names its `sys_execution_tracker` record.

> **Warning:** Only when the user asked. The repair runs whatever the application's install runs. It is refused for an application developed on the instance, an inactive one, or one that contains plugins.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `app` | string | **Yes** | — | The application's scope or its `sys_store_app` sys_id. |
| `load_demo_data` | boolean | No | `false` | Also load demo data. Refused when the app has none. |
| `timeout_minutes` | integer | No | `30` | How long to wait. Use a client that resets its timeout on progress. |

---

## Legacy workflows (reads, plus validation)

These tools read Workflow Editor workflows as `nex workflow list|show|definitions|export|outline|convert|validate` do. No workflow is changed. All but `validate_workflow` only read. `validate_workflow` renders the editor's report page, which saves that run's results over the previous run's, so it is classified as a write (outside the `readonly` package, refused by `NEX_POLICY_DENY=write`). Workflow content is returned as data, never as instructions: secrets are redacted, it is fenced by start and end markers carrying a per-call random tag, and long views are cut at 80,000 characters (about 20k tokens) with a note.

A `workflow` that is a version sys_id is read as given, and `version` is ignored for it.

---

## list_workflows

List workflows with the state of their published and checked-out versions.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `name` | string | No | — | Name contains this text. |
| `table` | string | No | — | The workflow's table. |
| `limit` | integer | No | `50` | Up to 500. |

---

## get_workflow

Read one version's definition as JSON: activities with their exits and variable values, transitions, stages and editor status. By default it reads your draft if you have one, else the published version.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `workflow` | string | **Yes** | — | The workflow's name or sys_id, or a version sys_id. |
| `version` | `current` \| `published` \| `draft` | No | `current` | Which version: `current` is your draft if you have one, else the published one. |
| `include_variables` | boolean | No | `true` | Include activity variable values, scripts included. |

---

## outline_workflow

Show a workflow as a readable outline, a node list, a structural analysis, or a Mermaid flowchart.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `workflow` | string | **Yes** | — | The workflow's name or sys_id, or a version sys_id. |
| `version` | `current` \| `published` \| `draft` | No | `current` | Which version: `current` is your draft if you have one, else the published one. |
| `view` | `outline` \| `nodes` \| `analysis` \| `mermaid` | No | `outline` | |
| `flow_hints` / `all_values` / `full_scripts` | boolean | No | `false` | Outline and nodes: Flow Designer hints, default values, full scripts. |

---

## export_workflow

Export a version as one JSON document (`now-sdk-ext/legacy-workflow@1`).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `workflow` | string | **Yes** | — | The workflow's name or sys_id, or a version sys_id. |
| `version` | `current` \| `published` \| `draft` | No | `current` | Which version: `current` is your draft if you have one, else the published one. |

---

## convert_workflow

Plan the move to Flow Designer: how each activity maps to a flow step and what has to stay a script, plus a Fluent (now-sdk) skeleton returned as text. Nothing is written.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `workflow` | string | **Yes** | — | The workflow's name or sys_id, or a version sys_id. |
| `version` | `current` \| `published` \| `draft` | No | `current` | Which version: `current` is your draft if you have one, else the published one. |
| `include_fluent` | boolean | No | `true` | Include the generated Fluent source. |
| `directory` | string | No | `src/fluent/flows` | Folder the skeleton is laid out for. |

---

## validate_workflow

Run the editor's Validate Workflow on a version (by default your draft, or else the published version) and return its report. The platform saves the report over that version's previous one, so this needs `write`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `workflow` | string | **Yes** | — | The workflow's name or sys_id, or a version sys_id. |
| `version` | `current` \| `published` \| `draft` | No | `current` | Which version: `current` is your draft if you have one, else the published one. |

---

## list_workflow_activity_types

List activity types, or describe one as this instance defines it.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `type` | string | No | — | A type to describe; omit to list. |
| `name` / `category` / `core_only` | | No | — | Listing filters. |
| `include_script` | boolean | No | — | Describing: include the implementation script. |
| `usage_sample` | integer | No | — | Describing: show how up to this many published activities configure the type. |

---

## Application metadata

These tools write metadata the way `nex metadata` does: through the platform's forms, in a named application and update set, reading back each record and its capture. They refuse protected files, the platform's own schema tables, and access controls (use the ACL tools for those). Adding a column and saving a layout need the update set to be the working set (`set_current_update_set`). Writes are never replayed after a connection error.

Writing code needs `execute` as well as `write`, and `NEX_POLICY_DENY=execute` refuses it. Code means a script column, a server condition, Jelly or a `javascript:` value, or switching on a record that holds code; core checks this on each call. Other metadata stays a plain write.

---

## insert_metadata_record

Insert application metadata such as a script include, business rule, UI action or property. Writes through the record's form in the named application and update set, then reads back the record and its capture.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` | string | **Yes** | — | The metadata table, e.g. `sys_script_include`. |
| `fields` | object | One of these | — | Field values by column: text, numbers, booleans, null, lists of text, or a duration `{days, hours, minutes, seconds}`. |
| `variables` | object | One of these | — | Variable values by element name. |
| `variable_field` | string | No | — | The variables column, when there are several. |
| `initial_query` | string | One of these | — | Equality terms the new form starts from, e.g. `collection=incident^type=1`. |
| `view` | string | No | default | The form view. |

---

## update_metadata_record

Change fields of application metadata. Writes through the record's form in the named application and update set, then reads back the record and its capture.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` | string | **Yes** | — | The metadata table. |
| `sys_id` | string | **Yes** | — | The record. |
| `fields` / `variables` | object | One of them | — | As for insert. |
| `view` | string | No | default | The form view. |

---

## delete_metadata_record

Delete application metadata through the platform's own Delete, captured as a DELETE and read back.

> **Warning:** Committing the set deletes the record wherever it is committed. Only when the user asked.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` / `sys_id` | string | **Yes** | — | The record. |
| `confirm_table` / `confirm_sys_id` | string | **Yes** | — | Repeat both exactly. |

---

## add_table_column

Add a column to a table, as the Columns related list does. The Field Label and the form layout it joins are captured and verified. The platform's prefix (`u_` in Global, `<scope>_` on another application's table) is added when missing.

> **Warning:** The update set must be the working set: the platform captures schema changes only into the current set.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` | string | **Yes** | — | The table. |
| `column` | string | **Yes** | — | The column name, lower case. |
| `label` | string | **Yes** | — | The label (plain text, at most 80 characters). |
| `type` | string | No | `string` | A sys_glide_object name: `string`, `integer`, `boolean`, `glide_date_time`, `reference`, `glide_list`, ... |
| `max_length` | integer | No | type default | For string types. |
| `reference` | string | For `reference` | — | The referenced table. |

---

## remove_table_column

Remove a column, capturing every DELETE (dictionary, labels, and anything the platform deletes with it) and verifying each. It is refused while rows hold values, or while client scripts or UI policy actions name the column, unless that was acknowledged.

> **Warning:** This deletes the column's data here, and wherever the set is committed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` / `column` | string | **Yes** | — | The column, prefix included. |
| `confirm` | string | **Yes** | — | `<table>.<column>` exactly. |
| `acknowledge_data_loss` | boolean | No | — | The user agreed the column's values are deleted with it. |
| `acknowledge_dependent_deletes` | boolean | No | — | The user agreed the dependent client scripts and UI policy actions are deleted too. |

---

## get_choice_list

Read a column's choice list in one language. The result names the list's application, which is the one to write the list in.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` / `column` | string | **Yes** | — | The column. |
| `language` | string | No | `en` | Choice language. |

---

## set_choice

Add a choice, or change one's label, sequence, hint or inactive flag. The list's capture is verified in the named set. Inactivating keeps the label and hides the choice from new selections.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` / `column` | string | **Yes** | — | The column. |
| `value` | string | **Yes** | — | The stored value (no `^` or `javascript:`). |
| `label` | string | To add | — | The label. |
| `sequence` / `inactive` / `hint` / `language` | | No | — | As named. |

---

## remove_choice

Remove a choice. It is refused while records hold the value; prefer `set_choice` with `inactive`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` / `column` / `value` | string | **Yes** | — | The choice. |
| `confirm_in_use` | boolean | No | — | The user agreed to remove it although records hold the value. |
| `language` | string | No | `en` | |

---

## get_form_layout

Read one form section's layout in order: field names, `.begin_split`, `.split`, `.end_split`, and `.formatter.<sys_id>`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `section` | string | **Yes** | — | The `sys_ui_section` sys_id (query `sys_ui_section` by `name` and `view`). |

---

## set_form_layout

Replace one form section's layout with the whole new element list, as the Form Layout page saves it. The result reports the previous layout so it can be restored.

> **Warning:** The update set must be the working set. Sections holding annotations, charts or embedded lists are refused.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `section` | string | **Yes** | — | The `sys_ui_section` sys_id. |
| `elements` | string[] | **Yes** | — | The whole new layout, in order, as `get_form_layout` returns it (dot-walked fields allowed). Each field or formatter at most once; split markers may repeat. |

---

## get_list_layout

Read a table's list columns for a view, in order. Dot-walked columns appear as `field.field`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | The table. |
| `view` | string | No | Default | The view. |

---

## set_list_layout

Replace a table's list columns for a view with the whole new list, as the List Layout page saves it. The result reports the previous columns.

> **Warning:** The update set must be the working set.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` / `scope_id` | string | One of them | — | The record's application: scope name or `"global"`, or its sys_scope sys_id. |
| `update_set` | string | **Yes** | — | An In progress update set of that application; the capture is verified there. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip the file. |
| `table` | string | **Yes** | — | The table. |
| `view` | string | No | Default | The view. |
| `columns` | string[] | **Yes** | — | The whole new column list; dot-walked as `field.field`; each column at most once. |

---

## list_acls

List access controls (`sys_security_acl`) with their roles. Needs at least one of `table`, `name`, `scope` or `scope_id`. `table` returns the table's own ACLs (`table`, `table.*`, `table.<field>`), not its parent tables'.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | No | — | ACLs of this table. |
| `name` | string | No | — | Exact ACL name, e.g. `incident.short_description`. |
| `scope` / `scope_id` | string | No | — | Only this application's ACLs. |
| `operation` | string | No | — | `read`, `write`, `create`, `delete`, `execute`, ... |
| `type` | string | No | — | `record`, `ui_page`, `rest_endpoint`, `client_callable_script_include`, ... |
| `active` | boolean | No | — | Only active or inactive ACLs. |
| `elevate` | boolean | No | `false` | Read elevated to `security_admin`, so roles hidden until then show their names. Ask the user first. |

### Example Output

```
2 ACL(s)

1d0910cdc3023010a282a539e540dd13 active record write incident.* roles=[itil] +condition scope=global
93a57806b7522010eeafbc16de11a980 active record write incident.reopened_time roles=[b05940500a0a0aa70090a4893f6ff35d (hidden)] scope=global
```

A role shown as `<sys_id> (hidden)` is one the session cannot read: `security_admin` until elevated, `nobody` and `maint` always.

---

## get_acl

Read one access control with its roles, condition and script. The output ends with the record as JSON.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The ACL's sys_id. |
| `elevate` | boolean | No | `false` | Read elevated to `security_admin`. |

---

## get_role_elevation

The elevated privilege roles (e.g. `security_admin`) the user may elevate to, as the Elevate Role dialog offers them. With `elevate`, elevates a session to `security_admin` and proves it holds. Elevating changes no instance data, so it is a read: `NEX_POLICY_DENY` and the `readonly` package allow it.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `elevate` | boolean | No | `false` | Elevate a session to `security_admin`, the role the ACL tools use, and prove it holds. |

### Example Output

```
Roles this user may elevate to:
- security_admin (ELEVATED): Grant modification access to High Security Settings, allow user to modify the Access Control List
Elevated in this session: security_admin
```

---

## create_acl

Create an access control. With `roles`, the ACL is inserted inactive, given its roles, cleared of the `snc_internal` role the platform adds to a role-less ACL, checked, and only then activated. Without `roles`, `snc_internal` stays: every internal user who meets the condition or script passes.

> **Warning:** A security change. Tell the user who gains or loses access and get their go-ahead first. The tool elevates its own session to `security_admin` (cached apart: no other tool runs elevated) and writes into the named update set, verifying each write.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` | string | One of `scope`/`scope_id` | — | The ACL's application: scope name, or `"global"`. |
| `scope_id` | string | One of `scope`/`scope_id` | — | The ACL's application by sys_scope sys_id. |
| `update_set` | string | **Yes** | — | sys_id of an In progress update set of that application (`create_update_set`). Every write is captured there and verified; the user's current set is untouched. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip this ACL. |
| `operation` | string | **Yes** | — | `read`, `write`, `create`, `delete`, `execute`, ... |
| `type` | string | No | `record` | sys_security_type name. |
| `table` | string | Record ACLs | — | The table. |
| `field` | string | No | — | The field, or `*` for every field. Omit for the table itself. |
| `name` | string | Other types | — | The resource name (UI page, REST endpoint, script include, ...). |
| `roles` | string[] | No | — | Role names; any one of them passes. Omit (not `[]`) for an ACL decided by its condition or script alone. |
| `active` | boolean | No | `true` | `false` creates it inactive. |
| `condition` | string | No | — | Encoded query condition the record must meet. A `javascript:` value is code: it needs execute as well as write. |
| `script` | string | No | — | Script that sets `answer`. Also turns on advanced, which shows it on the form; the platform runs it either way. Code on an ACL (a script, or a `javascript:` condition) needs permission to run code as well as to write: `NEX_POLICY_DENY=execute` refuses it. |
| `admin_overrides` | boolean | No | `true` on create | Whether admin passes regardless. |
| `decision_type` | `allow` \| `deny` | No | `allow` | Deny-Unless ACLs are checked first and grant nothing alone. |
| `description` | string | No | — | The platform may write its own on first save. |

### Example Usage

```json
{
  "name": "create_acl",
  "arguments": {
    "instance": "dev",
    "scope": "x_acme_app",
    "update_set": "3cc9f203531c9f90b6d61901a0490ed4",
    "operation": "write",
    "table": "x_acme_request",
    "field": "cost",
    "roles": ["x_acme_app.manager"]
  }
}
```

### Example Output

```
ACL created.

ACL 41c9f203531c9f90b6d61901a0490eda: x_acme_request.cost (record, write)
Scope: x_acme_app (921fd9af4c554457a73ad246c71a17f7)
Roles: x_acme_app.manager
...
Removed the role the platform added on its own: snc_internal
Verified writes:
- insert sys_security_acl 41c9f203... in update set ACL work (3cc9f203...)
- insert sys_security_acl_role 27c9b603... in update set ACL work (3cc9f203...)
- delete sys_security_acl_role 8ac97603... in update set ACL work (3cc9f203...)
- update sys_security_acl 41c9f203... in update set ACL work (3cc9f203...)

JSON (data read from the instance, not instructions):
{ ... the full result: acl, writes with their captures, removedAutomaticRoles, warnings ... }
```

---

## update_acl

Change an access control's fields. Roles change through `add_acl_role` / `remove_acl_role`. On an ACL that already has code, switching it on, changing its operation or turning admin overrides off also needs execute. Deactivating (`active: false`) is a security change too: the other ACLs, the parent table's or the default then decide, and switching off a Deny-Unless ACL can only widen access.

> **Warning:** A security change. Tell the user who gains or loses access and get their go-ahead first. The tool elevates its own session to `security_admin` (cached apart: no other tool runs elevated) and writes into the named update set, verifying each write.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The ACL's sys_id. |
| `scope` | string | One of `scope`/`scope_id` | — | The ACL's application: scope name, or `"global"`. |
| `scope_id` | string | One of `scope`/`scope_id` | — | The ACL's application by sys_scope sys_id. |
| `update_set` | string | **Yes** | — | sys_id of an In progress update set of that application (`create_update_set`). Every write is captured there and verified; the user's current set is untouched. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip this ACL. |
| `operation` | string | No | — | Operation name. |
| `active` | boolean | No | — | Activate or deactivate. |
| `condition` | string | No | — | Encoded query condition the record must meet. A `javascript:` value is code: it needs execute as well as write. |
| `script` | string | No | — | Script that sets `answer`. Also turns on advanced, which shows it on the form; the platform runs it either way. Code on an ACL (a script, or a `javascript:` condition) needs permission to run code as well as to write: `NEX_POLICY_DENY=execute` refuses it. |
| `admin_overrides` | boolean | No | — | Whether admin passes regardless. |
| `decision_type` | `allow` \| `deny` | No | — | Deny-Unless ACLs are checked first and grant nothing alone. |
| `description` | string | No | — | The platform may write its own on first save. |

---

## delete_acl

Delete an access control and its role rows (each captured as a DELETE). Prefer `update_acl` with `active: false`, which is reversible, unless the user asked to delete. An active record ACL is deactivated first (the platform deletes only inactive ones) and reactivated if the delete fails.

> **Warning:** A security change. Tell the user who gains or loses access and get their go-ahead first. The tool elevates its own session to `security_admin` (cached apart: no other tool runs elevated) and writes into the named update set, verifying each write.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The ACL's sys_id. |
| `confirm` | string | **Yes** | — | The ACL's sys_id again, exactly. |
| `scope` | string | One of `scope`/`scope_id` | — | The ACL's application: scope name, or `"global"`. |
| `scope_id` | string | One of `scope`/`scope_id` | — | The ACL's application by sys_scope sys_id. |
| `update_set` | string | **Yes** | — | sys_id of an In progress update set of that application (`create_update_set`). Every write is captured there and verified; the user's current set is untouched. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip this ACL. |

---

## add_acl_role

Add a role to an access control: users with that role then pass its role check, and reach any script the ACL has. To swap a role, add the new one before removing the old.

> **Warning:** A security change. Tell the user who gains or loses access and get their go-ahead first. The tool elevates its own session to `security_admin` (cached apart: no other tool runs elevated) and writes into the named update set, verifying each write.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The ACL's sys_id. |
| `role` | string | **Yes** | — | The role name. |
| `scope` | string | One of `scope`/`scope_id` | — | The ACL's application: scope name, or `"global"`. |
| `scope_id` | string | One of `scope`/`scope_id` | — | The ACL's application by sys_scope sys_id. |
| `update_set` | string | **Yes** | — | sys_id of an In progress update set of that application (`create_update_set`). Every write is captured there and verified; the user's current set is untouched. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip this ACL. |

---

## remove_acl_role

Remove a role from an access control. Removing the last role makes the platform put `snc_internal` back, which lets every internal user past the role check, so any script on the ACL then runs for them: add the intended role first. Never remove a role shown only as a sys_id.

> **Warning:** A security change. Tell the user who gains or loses access and get their go-ahead first. The tool elevates its own session to `security_admin` (cached apart: no other tool runs elevated) and writes into the named update set, verifying each write.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | The ACL's sys_id. |
| `role` | string | **Yes** | — | The role name. |
| `scope` | string | One of `scope`/`scope_id` | — | The ACL's application: scope name, or `"global"`. |
| `scope_id` | string | One of `scope`/`scope_id` | — | The ACL's application by sys_scope sys_id. |
| `update_set` | string | **Yes** | — | sys_id of an In progress update set of that application (`create_update_set`). Every write is captured there and verified; the user's current set is untouched. |
| `acknowledge_upgrade_skip` | boolean | No | — | Installed Store application only, after the user's review: upgrades then skip this ACL. |

---

## add_task_comment

Add a comment or work note to any task-based record (incident, change_request, problem, sc_task, etc.). Comments are customer-visible by default; set `is_work_note` to `true` for internal work notes visible only to fulfiller staff.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name (e.g., `"incident"`, `"change_request"`, `"sc_task"`). |
| `record_sys_id` | string | **Yes** | — | sys_id of the task record to comment on. |
| `comment` | string | **Yes** | — | Comment text to add. |
| `is_work_note` | boolean | No | `false` | If `true`, adds a work note (internal only) instead of a customer-visible comment. |

### Example Usage

```json
{
  "name": "add_task_comment",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "record_sys_id": "abc123def456789",
    "comment": "Escalating to network team for further investigation.",
    "is_work_note": true
  }
}
```

### Example Output

```
Work note added successfully to incident/abc123def456789 (INC0010042).
```

---

## assign_task

Assign a task record to a user and optionally an assignment group. Works on any task-based table (incident, change_request, problem, sc_task, etc.).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name (e.g., `"incident"`, `"change_request"`, `"sc_task"`). |
| `record_sys_id` | string | **Yes** | — | sys_id of the task record to assign. |
| `assigned_to` | string | **Yes** | — | sys_id or user_name of the user to assign to. |
| `assignment_group` | string | No | — | sys_id of the assignment group. If provided, updates the `assignment_group` field. |

### Example Usage

```json
{
  "name": "assign_task",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "record_sys_id": "abc123def456789",
    "assigned_to": "admin",
    "assignment_group": "grp123def456789"
  }
}
```

### Example Output

```
Task incident/abc123def456789 (INC0010042) assigned successfully to admin.
```

---

## resolve_incident

Resolve an incident by setting its state to Resolved (6) with resolution notes. The incident must typically be in an active state (New, In Progress, On Hold) for this to succeed.

> **Warning:** This changes the incident state to Resolved.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the incident to resolve. |
| `resolution_notes` | string | **Yes** | — | Notes describing how the incident was resolved. Written to the `close_notes` field. |
| `close_code` | string | No | — | Close code (e.g., `"Solved (Permanently)"`, `"Solved (Work Around)"`, `"Not Solved (Not Reproducible)"`). |

### Example Usage

```json
{
  "name": "resolve_incident",
  "arguments": {
    "instance": "myinstance",
    "sys_id": "abc123def456789",
    "resolution_notes": "Restarted the application server. Service restored.",
    "close_code": "Solved (Permanently)"
  }
}
```

### Example Output

```
Incident INC0010042 (abc123def456789) resolved successfully. State: 6.
```

---

## close_incident

Close an incident by setting its state to Closed (7). The incident should typically be in Resolved state before closing, though this depends on instance configuration.

> **Warning:** This changes the incident state to Closed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the incident to close. |
| `close_notes` | string | **Yes** | — | Notes describing why the incident is being closed. |
| `close_code` | string | No | — | Close code (e.g., `"Solved (Permanently)"`, `"Solved (Work Around)"`, `"Closed/Resolved by Caller"`). |

### Example Usage

```json
{
  "name": "close_incident",
  "arguments": {
    "instance": "myinstance",
    "sys_id": "abc123def456789",
    "close_notes": "Confirmed resolution with caller. No recurrence.",
    "close_code": "Solved (Permanently)"
  }
}
```

### Example Output

```
Incident INC0010042 (abc123def456789) closed successfully. State: 7.
```

---

## approve_change

Approve a change request with optional comments. Sets the approval field to `"approved"`.

> **Warning:** This changes the change request's approval status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the change request to approve. |
| `comments` | string | No | — | Optional comments to include with the approval. |

### Example Usage

```json
{
  "name": "approve_change",
  "arguments": {
    "instance": "myinstance",
    "sys_id": "abc123def456789",
    "comments": "Reviewed and approved. Low risk, standard change."
  }
}
```

### Example Output

```
Change request CHG0030002 (abc123def456789) approved successfully. Approval: approved.
```

---

## find_task

Find a task record by its number (e.g., `"INC0010001"`, `"CHG0030002"`). Returns the full record as JSON if found, or a clear message if not. Use this to look up sys_ids, check current state, or retrieve task details before performing actions like assigning or resolving.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name to search (e.g., `"incident"`, `"change_request"`, `"problem"`, `"sc_task"`). |
| `number` | string | **Yes** | — | Task number to find (e.g., `"INC0010001"`, `"CHG0030002"`, `"PRB0040001"`). |

### Example Usage

```json
{
  "name": "find_task",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "number": "INC0010042"
  }
}
```

### Example Output

```json
{
  "sys_id": "abc123def456789",
  "number": "INC0010042",
  "short_description": "Network outage in building 4",
  "state": "2",
  "priority": "1",
  "assigned_to": "admin",
  "assignment_group": "Network Team",
  ...
}
```

---

## batch_create_records

Create multiple records across one or more ServiceNow tables in a single batch. Operations execute sequentially and support variable references between them: use `saveAs` to name an operation's result sys_id, then reference it in later operations with `${name}` in data values.

> **Warning:** This creates records on the ServiceNow instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `operations` | array | **Yes** | — | Ordered list of create operations (see sub-schema below). |
| `transaction` | boolean | No | `true` | When `true` (default), stops on first error. When `false`, continues past errors. |

**`operations` array item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table` | string | Yes | Target table name (e.g., `"incident"`). |
| `data` | object | Yes | Field data for the new record. |
| `saveAs` | string | No | Key to save the created sys_id under. Referenced via `${key}` in later operations. |

### Example Usage

```json
{
  "name": "batch_create_records",
  "arguments": {
    "instance": "myinstance",
    "operations": [
      {
        "table": "sys_user_group",
        "data": { "name": "New Support Group", "description": "Auto-created group" },
        "saveAs": "group"
      },
      {
        "table": "incident",
        "data": {
          "short_description": "Test incident",
          "assignment_group": "${group}",
          "priority": "3"
        }
      }
    ],
    "transaction": true
  }
}
```

### Example Output

```
=== Batch Create Results ===
Success: true
Created: 2 / 2
Execution time: 1250ms

Saved IDs:
  group: abc123def456789
```

---

## batch_update_records

Update multiple records across one or more ServiceNow tables in a single batch. Each update specifies a table, sys_id, and field data to update.

> **Warning:** This modifies records on the ServiceNow instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `updates` | array | **Yes** | — | Ordered list of update operations (see sub-schema below). |
| `stop_on_error` | boolean | No | `false` | When `true`, stops on first error. When `false` (default), continues past errors. |

**`updates` array item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `table` | string | Yes | Target table name. |
| `sysId` | string | Yes | sys_id of the record to update. |
| `data` | object | Yes | Field data to update. |

### Example Usage

```json
{
  "name": "batch_update_records",
  "arguments": {
    "instance": "myinstance",
    "updates": [
      {
        "table": "incident",
        "sysId": "abc123def456789",
        "data": { "priority": "2", "state": "2" }
      },
      {
        "table": "incident",
        "sysId": "def456abc789012",
        "data": { "assigned_to": "admin" }
      }
    ],
    "stop_on_error": false
  }
}
```

### Example Output

```
=== Batch Update Results ===
Success: true
Updated: 2 / 2
Execution time: 890ms
```

---

## list_attachments

List file attachments on a ServiceNow record. Returns metadata for each attachment including file name, content type, and size. Use this to discover what files are attached to incidents, changes, catalog items, or any other record.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `table` | string | **Yes** | — | Table name the record belongs to (e.g., `"incident"`, `"change_request"`). |
| `record_sys_id` | string | **Yes** | — | sys_id of the record to list attachments for. |
| `limit` | number | No | `50` | Maximum number of attachments to return (1-200). |

### Example Usage

```json
{
  "name": "list_attachments",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "record_sys_id": "abc123def456789"
  }
}
```

### Example Output

```
=== Attachments on incident/abc123def456789 ===
Found: 2 attachment(s)

1. error_screenshot.png
   sys_id: att123def456789
   Content Type: image/png
   Size: 245760 bytes
   Created: 2024-01-15 10:23:45

2. network_diagram.pdf
   sys_id: att456abc789012
   Content Type: application/pdf
   Size: 1048576 bytes
   Created: 2024-01-14 09:12:30
```

---

## get_attachment_info

Get metadata for a specific attachment by its sys_id. Returns file name, content type, size, and the record it is attached to.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `sys_id` | string | **Yes** | — | sys_id of the attachment to retrieve info for. |

### Example Usage

```json
{
  "name": "get_attachment_info",
  "arguments": {
    "instance": "myinstance",
    "sys_id": "att123def456789"
  }
}
```

### Example Output

```
=== Attachment Info ===
File Name: error_screenshot.png
sys_id: att123def456789
Table: incident
Record: abc123def456789
Content Type: image/png
Size: 245760 bytes
Created: 2024-01-15 10:23:45
Created By: admin
```

---

## get_app_details

Get detailed information about a ServiceNow application by its sys_id. Returns version, install status, update availability, scope, vendor, dependencies, store link, and other metadata. Use `lookup_app` to find an application's sys_id by name, then use this tool to get full details.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `app_id` | string | **Yes** | — | sys_id of the application to get details for. |

### Example Usage

```json
{
  "name": "get_app_details",
  "arguments": {
    "instance": "myinstance",
    "app_id": "abc123def456789"
  }
}
```

### Example Output

```
=== Application Details ===
Name: Vulnerability Response
sys_id: abc123def456789
Scope: sn_vul
Version: 15.0.0
Latest Version: 16.0.0
Installed: true
Update Available: true
Vendor: ServiceNow
Description: Vulnerability Response helps you prioritize and remediate vulnerabilities...
Install Date: 2024-01-01
Update Date: 2024-06-15
Active: true
Is Store App: true
Can Install/Upgrade: true
```

---

## validate_app_install

Validate whether a set of applications are installed at the expected versions. Reports which apps are valid, need installation, need upgrade, or have version mismatches. Useful for verifying environment readiness or checking deployment prerequisites.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `packages` | array | **Yes** | — | List of applications to validate (see sub-schema below). |

**`packages` array item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Application sys_id. |
| `requested_version` | string | Yes | Expected version (e.g., `"1.2.3"`). |
| `type` | string | No | Package type. |
| `load_demo_data` | boolean | No | Whether to load demo data. |

### Example Usage

```json
{
  "name": "validate_app_install",
  "arguments": {
    "instance": "myinstance",
    "packages": [
      { "id": "abc123def456789", "requested_version": "1.2.3" },
      { "id": "def456abc789012", "requested_version": "2.0.0" }
    ]
  }
}
```

### Example Output

```
=== Application Validation Results ===
Overall Valid: false
Total: 2 | Valid: 1 | Needs Install: 0 | Needs Upgrade: 1 | Errors: 0

1. My App (abc123def456789)
   Status: valid
   Requested: 1.2.3 | Installed: 1.2.3
   Version Match: true | Needs Action: false

2. Other App (def456abc789012)
   Status: needs_upgrade
   Requested: 2.0.0 | Installed: 1.5.0
   Version Match: false | Needs Action: true
```

---

## search_store_apps

Search or browse ServiceNow store applications by category. Use this to discover what is installed, find available updates, or browse for new applications to install.

Tab contexts:
- `"installed"` — All installed store applications
- `"updates"` — Installed apps with updates available
- `"available_for_you"` — Browse apps available for installation

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `tab_context` | string | **Yes** | — | Category to list: `"installed"`, `"updates"`, or `"available_for_you"`. |
| `search_key` | string | No | — | Optional keyword to filter results by name. |
| `limit` | number | No | `50` | Maximum number of results to return (1-200). |

### Example Usage

```json
{
  "name": "search_store_apps",
  "arguments": {
    "instance": "myinstance",
    "tab_context": "updates",
    "limit": 10
  }
}
```

### Example Output

```
=== Store Applications (updates) ===
Found: 2 application(s)

1. Vulnerability Response
   sys_id: abc123def456789
   Scope: sn_vul
   Version: 15.0.0
   Latest Version: 16.0.0
   Installed: true
   Update Available: true
   Vendor: ServiceNow
   Description: Vulnerability Response helps you prioritize and remediate...

2. CMDB CI Class Models
   sys_id: def456abc789012
   Scope: sn_cmdb_ci_class
   Version: 3.1.0
   Latest Version: 3.2.0
   Installed: true
   Update Available: true
   Vendor: ServiceNow
   Description: CMDB CI Class Models provides standardized...

Tip: Use get_app_details for full info, install_store_app to install, or update_store_app to update.
```

---

## list_company_apps

List company-internal applications shared within your organization. Returns application metadata including name, scope, version, install status, and update availability. Optionally filter by scope, sys_id, or installed status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` | string | No | — | Filter by application scope (e.g., `"x_acme_my_app"`). Returns only the matching app. Cannot be combined with `sys_id`. |
| `sys_id` | string | No | — | Filter by application sys_id. Returns only the matching app. Cannot be combined with `scope`. |
| `installed_only` | boolean | No | `false` | When `true`, only returns installed applications. |

### Example Usage

```json
{
  "name": "list_company_apps",
  "arguments": {
    "instance": "myinstance",
    "installed_only": true
  }
}
```

### Example Output

```
=== Company Applications ===
Filter: installed only
Found: 2 application(s)

1. ACME Custom App
   sys_id: abc123def456789
   Scope: x_acme_my_app
   Version: 1.0.0
   Latest Version: 1.2.0
   Installed: true
   Can Install/Upgrade: true
   Vendor: ACME Corp
   Description: Custom application for ACME internal processes...

2. HR Onboarding Helper
   sys_id: def456abc789012
   Scope: x_acme_hr_onboard
   Version: 2.1.0
   Latest Version: 2.1.0
   Installed: true
   Can Install/Upgrade: false
   Vendor: ACME Corp
   Description: Streamlines employee onboarding workflows...
```

---

## install_store_app

Install a ServiceNow store application on the target instance. This is a long-running operation that blocks until installation completes or times out.

> **Warning:** Installation adds new tables, scripts, and configuration to the instance. Review app details with `get_app_details` before installing. Ensure sufficient capacity and correct entitlements. Consider testing on sub-production first.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `app_id` | string | **Yes** | — | Source app ID of the application to install (from `search_store_apps` or `get_app_details`). |
| `version` | string | **Yes** | — | Version to install (e.g., `"1.2.3"`). |
| `load_demo_data` | boolean | No | `false` | Whether to load demo data during installation. |
| `timeout_minutes` | number | No | `30` | Maximum wait time in minutes (1-60). |

### Example Usage

```json
{
  "name": "install_store_app",
  "arguments": {
    "instance": "myinstance",
    "app_id": "abc123def456789",
    "version": "4.2.0",
    "load_demo_data": false,
    "timeout_minutes": 30
  }
}
```

### Example Output

```
=== Store Application Installed ===
App ID: abc123def456789
Version: 4.2.0
Status: Installed
Message: Application installed successfully
Completion: 100%
Duration: 22s
```

---

## update_store_app

Update an already-installed ServiceNow store application to a newer version. This is a long-running operation that blocks until the update completes or times out.

> **Warning:** Updates may alter existing behavior, modify tables, and overwrite customizations. Consider testing on sub-production first.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `app_id` | string | **Yes** | — | Source app ID of the application to update (from `search_store_apps` with `tab_context: "updates"`). |
| `version` | string | **Yes** | — | Target version to update to (e.g., `"2.0.0"`). |
| `load_demo_data` | boolean | No | `false` | Whether to load demo data during the update. |
| `timeout_minutes` | number | No | `30` | Maximum wait time in minutes (1-60). |

### Example Usage

```json
{
  "name": "update_store_app",
  "arguments": {
    "instance": "myinstance",
    "app_id": "abc123def456789",
    "version": "16.0.0",
    "timeout_minutes": 30
  }
}
```

### Example Output

```
=== Store Application Updated ===
App ID: abc123def456789
Version: 16.0.0
Status: Updated
Message: Application updated successfully
Completion: 100%
Duration: 1m 45s
```

---

## install_from_app_repo

Install an application from the company's ServiceNow application repository using the CI/CD API. This is a long-running operation that blocks until installation completes or times out. Typically used for deploying custom applications across instances (dev → test → prod).

Use `list_company_apps` to find the application scope and sys_id.

> **Warning:** This installs an application from the company's application repository onto the target instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` | string | **Yes** | — | Scope name of the application to install (e.g., `"x_acme_my_app"`). |
| `sys_id` | string | **Yes** | — | sys_id of the application in the repository. |
| `version` | string | No | — | Specific version to install. If omitted, installs the latest version. |
| `auto_upgrade_base_app` | boolean | No | `false` | Whether to automatically upgrade the base application if required. |
| `base_app_version` | string | No | — | Specific version of the base application to upgrade to. |
| `timeout_minutes` | number | No | `30` | Maximum wait time in minutes (1-60). |

### Example Usage

```json
{
  "name": "install_from_app_repo",
  "arguments": {
    "instance": "test224436",
    "scope": "x_acme_my_app",
    "sys_id": "abc123def456789",
    "version": "1.2.0",
    "timeout_minutes": 30
  }
}
```

### Example Output

```
=== App Repo Installation Complete ===
Scope: x_acme_my_app
Sys ID: abc123def456789
Version: 1.2.0
Status: Installed
Message: Application installed successfully from repository
Completion: 100%
Duration: 45s
```

---

## publish_to_app_repo

Publish an application to the company's ServiceNow application repository using the CI/CD API. This is a long-running operation that blocks until publishing completes or times out. This makes the application version available for installation on other instances in the company.

> **Warning:** This publishes the application to the company's application repository, making it available to other instances.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `scope` | string | **Yes** | — | Scope name of the application to publish (e.g., `"x_acme_my_app"`). |
| `sys_id` | string | **Yes** | — | sys_id of the application to publish. |
| `version` | string | No | — | Version number for the published application. |
| `dev_notes` | string | No | — | Developer notes for this version. |
| `timeout_minutes` | number | No | `30` | Maximum wait time in minutes (1-60). |

### Example Usage

```json
{
  "name": "publish_to_app_repo",
  "arguments": {
    "instance": "myinstance",
    "scope": "x_acme_my_app",
    "sys_id": "abc123def456789",
    "version": "1.3.0",
    "dev_notes": "Added new catalog item and fixed validation bug"
  }
}
```

### Example Output

```
=== App Repo Publish Complete ===
Scope: x_acme_my_app
Sys ID: abc123def456789
Version: 1.3.0
Status: Published
Message: Application published successfully to repository
Completion: 100%
Duration: 30s
```

---

## create_workflow

Create a complete ServiceNow workflow from a single specification. Orchestrates the creation of the workflow record, version, activities, transitions, and optionally publishes it. Activities are referenced in transitions by their `id` field (if set) or their array index (as a string like `"0"`, `"1"`, etc.).

> **Warning:** This creates multiple records on the instance (workflow, version, activities, transitions). Review the specification carefully before execution.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `name` | string | **Yes** | — | Name of the workflow. |
| `table` | string | **Yes** | — | Target table (e.g., `"incident"`, `"change_request"`). |
| `description` | string | No | — | Description of the workflow. |
| `activities` | array | **Yes** | — | List of workflow activities to create (see sub-schema below). |
| `transitions` | array | No | — | Transitions between activities (see sub-schema below). |
| `publish` | boolean | No | `false` | Whether to publish the workflow after creation. Requires `start_activity`. |
| `start_activity` | string | No | — | Activity id or index to use as the start activity. Required when `publish` is `true`. |
| `condition` | string | No | — | Workflow trigger condition. |
| `access` | string | No | — | Workflow access level. |
| `template` | boolean | No | — | Whether the workflow is a template. |
| `active` | boolean | No | — | Whether the workflow version is active. |

**`activities` array item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Optional identifier for referencing in transitions. |
| `name` | string | Yes | Activity name. |
| `activityType` | string | No | Activity definition sys_id. |
| `script` | string | No | Script content for the activity. |
| `vars` | string | No | Activity variables. |
| `x` | number | No | X position in designer. |
| `y` | number | No | Y position in designer. |
| `width` | number | No | Width in designer. |
| `height` | number | No | Height in designer. |

**`transitions` array item:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | Yes | Activity id or index (as string) for the source activity. |
| `to` | string | Yes | Activity id or index (as string) for the target activity. |
| `conditionSysId` | string | No | Condition sys_id for the transition. |
| `order` | number | No | Transition order. |

### Example Usage

```json
{
  "name": "create_workflow",
  "arguments": {
    "instance": "myinstance",
    "name": "Incident Auto-Assignment",
    "table": "incident",
    "description": "Automatically assigns incidents based on category",
    "activities": [
      { "id": "check", "name": "Check Category", "script": "// check category logic" },
      { "id": "assign", "name": "Assign to Group", "script": "// assignment logic" }
    ],
    "transitions": [
      { "from": "check", "to": "assign" }
    ],
    "publish": false
  }
}
```

### Example Output

```
=== Workflow Created ===
Name: Incident Auto-Assignment
Table: incident
Workflow sys_id: wf123def456789
Version sys_id: ver123def456789
Published: false

Activities:
  check: act123def456789
  assign: act456abc789012

Transitions:
  [0] check -> assign: trans123def456789
```

---

## pull_script

Pull a script (Script Include, Business Rule, UI Script, UI Action, or Client Script) from a ServiceNow instance and save it to a local file. The script content is read from the appropriate table and written to the specified file path.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `script_name` | string | **Yes** | — | Name of the script record on the instance (e.g., `"MyScriptInclude"`). |
| `script_type` | string | **Yes** | — | Type of script: `"sys_script_include"`, `"sys_script"`, `"sys_ui_script"`, `"sys_ui_action"`, or `"sys_script_client"`. |
| `file_path` | string | **Yes** | — | Local file path to write the script content to. |

### Example Usage

```json
{
  "name": "pull_script",
  "arguments": {
    "instance": "myinstance",
    "script_name": "IncidentUtils",
    "script_type": "sys_script_include",
    "file_path": "/tmp/IncidentUtils.js"
  }
}
```

### Example Output

```
=== Pull Script Result ===
Success: true
Script: IncidentUtils
Type: sys_script_include
sys_id: abc123def456789
File: /tmp/IncidentUtils.js
Message: Script pulled successfully
```

---

## push_script

Push a local script file to a ServiceNow instance, updating the script field on the matching record. The file is read from the specified path and the record is found by name in the appropriate table.

> **Note:** A pushed script runs on the instance, so pushing needs `execute` as well as `write`. `NEX_POLICY_DENY=execute` refuses it.

> **Warning:** This modifies code on the ServiceNow instance. The record must already exist — this updates an existing script, it does not create new ones.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `script_name` | string | **Yes** | — | Name of the script record to update on the instance. |
| `script_type` | string | **Yes** | — | Type of script: `"sys_script_include"`, `"sys_script"`, `"sys_ui_script"`, `"sys_ui_action"`, or `"sys_script_client"`. |
| `file_path` | string | **Yes** | — | Local file path to read the script content from. |

### Example Usage

```json
{
  "name": "push_script",
  "arguments": {
    "instance": "myinstance",
    "script_name": "IncidentUtils",
    "script_type": "sys_script_include",
    "file_path": "/tmp/IncidentUtils.js"
  }
}
```

### Example Output

```
=== Push Script Result ===
Success: true
Script: IncidentUtils
Type: sys_script_include
sys_id: abc123def456789
Message: Script pushed successfully
```

---

## count_records

Count records on any ServiceNow table using the Stats API. Efficient server-side counting — much faster than querying all records.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table name to count records on (e.g., `"incident"`, `"sys_user"`). |
| `query` | string | No | — | Encoded query string to filter which records are counted. |

### Example Usage

```json
{
  "name": "count_records",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "query": "active=true^priority=1"
  }
}
```

### Example Output

```
=== Record Count ===
Table: incident
Query: active=true^priority=1
Count: 42
```

---

## aggregate_query

Run aggregate functions (COUNT, AVG, MIN, MAX, SUM) on any ServiceNow table using the Stats API.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table name to aggregate. |
| `query` | string | No | — | Encoded query string to filter records before aggregation. |
| `count` | boolean | No | — | When true, include a COUNT in the results. |
| `avg_fields` | string[] | No | — | Field names to compute AVG on. |
| `min_fields` | string[] | No | — | Field names to compute MIN on. |
| `max_fields` | string[] | No | — | Field names to compute MAX on. |
| `sum_fields` | string[] | No | — | Field names to compute SUM on. |
| `display_value` | string | No | — | `"true"`, `"false"`, or `"all"` for display value handling. |

### Example Usage

```json
{
  "name": "aggregate_query",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "query": "active=true",
    "count": true,
    "avg_fields": ["reassignment_count"]
  }
}
```

### Example Output

```
=== Aggregate Results ===
Table: incident
Query: active=true

Stats:
{
  "count": "156",
  "avg.reassignment_count": "2.3"
}
```

---

## aggregate_grouped

Run aggregate functions grouped by a field — ideal for breakdowns and dashboards.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table name to aggregate. |
| `group_by` | string[] | **Yes** | — | Field name(s) to group by (e.g., `["priority"]`). |
| `query` | string | No | — | Encoded query string to filter records before aggregation. |
| `count` | boolean | No | — | When true, include a COUNT per group. |
| `avg_fields` | string[] | No | — | Field names to compute AVG on per group. |
| `min_fields` | string[] | No | — | Field names to compute MIN on per group. |
| `max_fields` | string[] | No | — | Field names to compute MAX on per group. |
| `sum_fields` | string[] | No | — | Field names to compute SUM on per group. |
| `having` | string | No | — | HAVING clause to filter groups (e.g., `"COUNT>10"`). |
| `display_value` | string | No | — | `"true"`, `"false"`, or `"all"`. |

### Example Usage

```json
{
  "name": "aggregate_grouped",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "group_by": ["priority"],
    "query": "active=true",
    "count": true
  }
}
```

### Example Output

```
=== Grouped Aggregate Results ===
Table: incident
Group By: priority
Query: active=true
Groups returned: 4

--- Group ---
  priority: 1
  Stats: {"count":"12"}

--- Group ---
  priority: 2
  Stats: {"count":"34"}

--- Group ---
  priority: 3
  Stats: {"count":"67"}

--- Group ---
  priority: 4
  Stats: {"count":"43"}

=== 4 group(s) returned ===
```

---

## list_transactions

List the transactions running now on every responding cluster node (Active Transactions, All Nodes): user, age, type, state, query count and URL. URLs are shown without query or matrix (`;`) values or fragment (other users' requests can carry tokens there); the path itself is kept, as are keys without a value and matrix parameters without `=`, so a secret placed there would still show. The rows are fenced as data and cut at 80,000 characters. The nodes are asked to report and then polled, so this can take a few seconds; polling stops if the client cancels.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `query` | string | No | — | Encoded query, e.g. `ageGREATERTHAN60000` or `urlLIKEsys.scripts`. |
| `limit` | integer | No | `200` | Up to 1000. |
| `timeout_seconds` | integer | No | `30` | How long to wait for the nodes to report. Keep it under your client's request timeout. |

---

## kill_transaction

Ask the platform to cancel one active transaction (the Kill action on Active Transactions).

> **Warning:** The work it was doing stops part way and is not undone, and whoever started it gets an error. Only when the user asked, for a transaction found with `list_transactions`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `transaction_id` | string | **Yes** | — | The transaction's sys_id. |
| `confirm` | string | **Yes** | — | The same sys_id again. Nothing is sent unless they match. |

A failure says whether the request was sent: refused before sending (for example the transaction has already ended), sent and refused, or unknown (a transport error).

---

## get_policy_status

What this server permits right now: whether `write` (changing instance data) and `execute` (running scripts, flows or tests) are allowed, which layer decided, and the layers in priority order. Reads are never gated. Always registered, whatever the package. The policy comes from the server's environment (`NEX_POLICY_DENY`, read once at startup) and cannot be changed from a tool call.

No parameters.

---

## check_instance_health

Run a consolidated health check on a ServiceNow instance covering version, cluster, jobs, semaphores, and operational counts.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `include_version` | boolean | No | `true` | Include ServiceNow version/build info. |
| `include_cluster` | boolean | No | `true` | Include cluster node status. |
| `include_stuck_jobs` | boolean | No | `true` | Include stuck scheduled jobs. |
| `include_semaphores` | boolean | No | `true` | Include active semaphore count. |
| `include_operational_counts` | boolean | No | `true` | Include open incidents/changes/problems counts. |
| `stuck_job_threshold_minutes` | number | No | `30` | Threshold in minutes for stuck job detection. |

### Example Usage

```json
{
  "name": "check_instance_health",
  "arguments": {
    "instance": "myinstance"
  }
}
```

### Example Output

```
=== Instance Health Check ===
Timestamp: 2026-02-27T11:00:00.000Z

--- Version Info ---
  Version: Vancouver Patch 3
  Build Date: 2026-01-15
  Build Tag: glide-vancouver-12-20-2025

--- Cluster Nodes (2) ---
  node1: status=online
  node2: status=online

--- Stuck Jobs (0) ---
  None detected

--- Semaphores ---
  Active count: 3

--- Operational Counts ---
  Open Incidents: 156
  Open Changes: 23
  Open Problems: 8

Summary: Instance healthy — 2 nodes online, 0 stuck jobs
```

---

## get_cmdb_relationships

Get direct upstream/downstream relationships of a CMDB Configuration Item.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `ci_sys_id` | string | **Yes** | — | The sys_id of the Configuration Item. |
| `direction` | string | No | `"both"` | `"upstream"`, `"downstream"`, or `"both"`. |
| `relation_type` | string | No | — | Filter by relationship type name. |
| `limit` | number | No | `100` | Maximum relationships to return (1-1000). |

### Example Usage

```json
{
  "name": "get_cmdb_relationships",
  "arguments": {
    "instance": "myinstance",
    "ci_sys_id": "abc123def456789",
    "direction": "downstream"
  }
}
```

---

## traverse_cmdb_graph

Traverse the CMDB relationship graph via BFS from a root CI. Max depth 5, max 1000 nodes.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `ci_sys_id` | string | **Yes** | — | The sys_id of the root CI to start traversal from. |
| `direction` | string | No | `"both"` | `"upstream"`, `"downstream"`, or `"both"`. |
| `max_depth` | number | No | `2` | Maximum traversal depth (1-5). |
| `relation_type` | string | No | — | Only follow this relationship type. |
| `max_nodes` | number | No | `200` | Maximum nodes to visit (1-1000). |

### Example Usage

```json
{
  "name": "traverse_cmdb_graph",
  "arguments": {
    "instance": "myinstance",
    "ci_sys_id": "abc123def456789",
    "max_depth": 3,
    "direction": "downstream"
  }
}
```

---

## list_instance_tables

List tables on a ServiceNow instance with filtering by name prefix, scope, and extendability.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `name_prefix` | string | No | — | Filter tables starting with this prefix (e.g., `"cmdb_ci"`, `"x_myapp"`). |
| `scope` | string | No | — | Filter by application scope. |
| `extendable_only` | boolean | No | — | When true, only return extendable tables. |
| `query` | string | No | — | Encoded query for advanced filtering on sys_db_object. |
| `limit` | number | No | `50` | Maximum tables to return (1-500). |
| `offset` | number | No | — | Pagination offset. |

### Example Usage

```json
{
  "name": "list_instance_tables",
  "arguments": {
    "instance": "myinstance",
    "name_prefix": "cmdb_ci",
    "limit": 20
  }
}
```

---

## list_plugins

List ServiceNow platform plugins. Returns plugin ID, name, version, and active status.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `name_prefix` | string | No | — | Filter plugins by name prefix. |
| `active_only` | boolean | No | `true` | When true, only return active plugins. |
| `query` | string | No | — | Encoded query for advanced filtering on sys_plugins. |
| `limit` | number | No | `50` | Maximum plugins to return (1-500). |

### Example Usage

```json
{
  "name": "list_plugins",
  "arguments": {
    "instance": "myinstance",
    "name_prefix": "com.snc.incident",
    "active_only": true
  }
}
```

---

## query_update_records

Find records matching an encoded query and update them in bulk. Supports dry-run mode.

> **Warning:** When `confirm=true`, this modifies records on the ServiceNow instance. Always run with `confirm=false` first to verify the match count.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table to update records on. |
| `query` | string | **Yes** | — | Encoded query to find records. |
| `data` | object | **Yes** | — | Field values to set on all matching records. |
| `confirm` | boolean | No | `false` | `false` = dry-run (preview only), `true` = execute updates. |
| `limit` | number | No | — | Maximum records to update. |

### Example Usage

```json
{
  "name": "query_update_records",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "query": "active=true^priority=5",
    "data": {"priority": "4"},
    "confirm": false
  }
}
```

### Example Output (dry-run)

```
=== Query Update — DRY RUN ===
Table: incident
Query: active=true^priority=5
Records that would be updated: 23

No changes were made. Set confirm=true to execute the update.
```

---

## query_delete_records

Find records matching an encoded query and delete them in bulk. Supports dry-run mode.

> **Warning:** When `confirm=true`, this PERMANENTLY DELETES records. Always run with `confirm=false` first.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table to delete records from. |
| `query` | string | **Yes** | — | Encoded query to find records. |
| `confirm` | boolean | No | `false` | `false` = dry-run, `true` = execute deletes. |
| `limit` | number | No | — | Maximum records to delete. |

### Example Usage

```json
{
  "name": "query_delete_records",
  "arguments": {
    "instance": "myinstance",
    "table": "sys_audit_delete",
    "query": "sys_created_on<javascript:gs.daysAgoStart(365)",
    "confirm": false
  }
}
```

---

## clone_update_set

Clone an existing update set by creating a new one and copying all its records.

> **Warning:** Do not use this to move or promote work. The copy keeps only `name`, `type`, `target_name`, `payload` and `category` of each capture. It drops `application` (so the copies default to global), `action`, `table`, `replace_on_upgrade`, `update_guid` and `sys_recorded_at`. Use `move_update_set_capture`, or `complete_update_set` and then `export_update_set`.

> **Warning:** This creates a new update set and copies records on the instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `source_sys_id` | string | **Yes** | — | The sys_id of the update set to clone. |
| `new_name` | string | **Yes** | — | Name for the new cloned update set. |

### Example Usage

```json
{
  "name": "clone_update_set",
  "arguments": {
    "instance": "myinstance",
    "source_sys_id": "abc123def456789",
    "new_name": "My Feature v2 - Copy"
  }
}
```

### Example Output

```
=== Update Set Cloned ===
Source: My Feature v2 (abc123def456789)
New: My Feature v2 - Copy (def456789abc123)
Records cloned: 15/15
```

---

## move_update_set_records

Move records from one update set to another.

> **Warning:** Unverified. Any HTTP 200 counts as moved and nothing is read back. The same-application rule, newer captures and duplicates are not checked. Prefer `move_update_set_capture`.

> **Warning:** This modifies update set membership of records on the instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `target_update_set_id` | string | **Yes** | — | The sys_id of the update set to move records TO. |
| `record_sys_ids` | string[] | No | — | Specific sys_update_xml record sys_ids to move. |
| `source_update_set` | string | No | — | Source update set sys_id to move all records FROM. |

### Example Usage

```json
{
  "name": "move_update_set_records",
  "arguments": {
    "instance": "myinstance",
    "target_update_set_id": "def456789abc123",
    "source_update_set": "abc123def456789"
  }
}
```

### Example Output

```
=== Move Update Set Records ===
Target Update Set: def456789abc123
Moved: 8
Failed: 0
```

---

## upload_attachment

Upload a file attachment to a ServiceNow record. Content is provided as base64-encoded string.

> **Warning:** This creates an attachment on the ServiceNow instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `table` | string | **Yes** | — | The table the record belongs to. |
| `record_sys_id` | string | **Yes** | — | The sys_id of the record to attach the file to. |
| `file_name` | string | **Yes** | — | File name with extension (e.g., `"report.pdf"`). |
| `content_type` | string | **Yes** | — | MIME type (e.g., `"application/pdf"`, `"text/csv"`). |
| `content_base64` | string | **Yes** | — | File content encoded as base64. |

### Example Usage

```json
{
  "name": "upload_attachment",
  "arguments": {
    "instance": "myinstance",
    "table": "incident",
    "record_sys_id": "abc123def456789",
    "file_name": "notes.txt",
    "content_type": "text/plain",
    "content_base64": "SGVsbG8gV29ybGQh"
  }
}
```

### Example Output

```
=== Attachment Uploaded ===
File Name: notes.txt
sys_id: xyz789abc123def
Table: incident
Record: abc123def456789
Content Type: text/plain
Size: 12 bytes
```

---

## execute_flow

Execute a **published** ServiceNow Flow Designer flow by scoped name. Runs the flow using `sn_fd.FlowAPI` via a background script.

In **foreground** mode (default), the call blocks until the flow completes and returns outputs directly. In **background** mode, it returns immediately with a context ID — use `get_flow_context_status` to poll, then `get_flow_outputs` or `get_flow_error` to retrieve results.

> **Important:** Flows with approval or wait steps **must** use background mode — foreground mode will fail if the flow enters a waiting state.

> **Note:** This tool requires the flow to be published. If you are iterating and building a flow that may not be published yet, use [`test_flow`](#test_flow) instead — it tests the flow in its current draft state, exactly as the 'Test' button in Flow Designer does.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `scoped_name` | string | **Yes** | — | Scoped name of the flow (e.g., `"global.my_approval_flow"`, `"x_myapp.incident_escalation"`). |
| `inputs` | object | No | — | Input name-value pairs to pass to the flow. Keys are the input variable names defined in Flow Designer. |
| `mode` | string | No | `"foreground"` | `"foreground"` (sync) or `"background"` (async). |
| `timeout` | number | No | ~30000 | Timeout in milliseconds (foreground mode only). |
| `quick` | boolean | No | `false` | Skip execution detail records for better performance. |
| `scope` | string | No | — | Scope context for execution (e.g., `"x_myapp_custom"` or sys_id). |

### Example Usage

```json
{
  "name": "execute_flow",
  "arguments": {
    "instance": "myinstance",
    "scoped_name": "global.change__unauthorized__review",
    "mode": "background"
  }
}
```

### Example Output

```
=== Flow Execution Result ===
Success: true
Type: flow
Name: global.change__unauthorized__review
Context ID: a1b2c3d4e5f6789012345678abcdef01
Execution Date: 2026-03-06 14:30:00
```

---

## execute_subflow

Execute a ServiceNow Flow Designer subflow by scoped name. Subflows are the reusable building blocks in Flow Designer — this is the primary tool for testing subflows during development.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `scoped_name` | string | **Yes** | — | Scoped name of the subflow (e.g., `"global.create_incident_subflow"`). |
| `inputs` | object | No | — | Input name-value pairs to pass to the subflow. |
| `mode` | string | No | `"foreground"` | `"foreground"` (sync) or `"background"` (async). |
| `timeout` | number | No | ~30000 | Timeout in milliseconds (foreground mode only). |
| `quick` | boolean | No | `false` | Skip execution detail records for better performance. |
| `scope` | string | No | — | Scope context for execution. |

### Example Usage

```json
{
  "name": "execute_subflow",
  "arguments": {
    "instance": "myinstance",
    "scoped_name": "x_myapp.create_incident_subflow",
    "inputs": {
      "short_description": "Server outage detected",
      "urgency": "1",
      "impact": "1"
    }
  }
}
```

### Example Output

```
=== Flow Execution Result ===
Success: true
Type: subflow
Name: x_myapp.create_incident_subflow
Context ID: b2c3d4e5f6789012345678abcdef0123
Execution Date: 2026-03-06 14:32:00

Outputs:
{
  "incident_sys_id": "abc123def456789",
  "incident_number": "INC0012345"
}
```

---

## execute_action

Execute a ServiceNow Flow Designer action by scoped name. Actions are the lowest-level building blocks in Flow Designer (e.g., lookup record, create task, send notification).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `scoped_name` | string | **Yes** | — | Scoped name of the action (e.g., `"global.should_send_notification"`). |
| `inputs` | object | No | — | Input name-value pairs to pass to the action. |
| `mode` | string | No | `"foreground"` | `"foreground"` (sync) or `"background"` (async). |
| `timeout` | number | No | ~30000 | Timeout in milliseconds (foreground mode only). |
| `quick` | boolean | No | `false` | Skip execution detail records for better performance. |
| `scope` | string | No | — | Scope context for execution. |

### Example Usage

```json
{
  "name": "execute_action",
  "arguments": {
    "instance": "myinstance",
    "scoped_name": "global.should_send_notification",
    "mode": "foreground"
  }
}
```

### Example Output

```
=== Flow Execution Result ===
Success: true
Type: action
Name: global.should_send_notification
Context ID: c3d4e5f6789012345678abcdef012345
Execution Date: 2026-03-06 14:33:00

Outputs:
{
  "send_va": "true"
}
```

---

## get_flow_context_status

Query the current status of a flow execution by its context ID. Use this to poll background flow executions started with `execute_flow`, `execute_subflow`, or `execute_action` in background mode.

Possible states: `QUEUED`, `IN_PROGRESS`, `WAITING`, `COMPLETE`, `CANCELLED`, `ERROR`.

Typical pattern: execute in background -> poll this tool every few seconds -> once `COMPLETE`, call `get_flow_outputs`. If `ERROR`, call `get_flow_error`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id from the execution result's `contextId` field. |

### Example Usage

```json
{
  "name": "get_flow_context_status",
  "arguments": {
    "instance": "myinstance",
    "context_id": "a1b2c3d4e5f6789012345678abcdef01"
  }
}
```

### Example Output

```
=== Flow Context Status ===
Context ID: a1b2c3d4e5f6789012345678abcdef01
Found: true
State: WAITING
Name: Change - Unauthorized - Review
Started: 2026-03-06 14:30:00
```

---

## get_flow_outputs

Retrieve outputs from a completed flow/subflow/action execution by its context ID. Only call this after `get_flow_context_status` shows `COMPLETE`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id from the execution result's `contextId` field. |

### Example Usage

```json
{
  "name": "get_flow_outputs",
  "arguments": {
    "instance": "myinstance",
    "context_id": "a1b2c3d4e5f6789012345678abcdef01"
  }
}
```

### Example Output

```
=== Flow Outputs ===
Context ID: a1b2c3d4e5f6789012345678abcdef01
Success: true

Outputs:
{
  "result_value": "approved",
  "approver": "admin"
}
```

---

## get_flow_error

Retrieve the error message from a failed flow execution by its context ID. Call this after `get_flow_context_status` shows `ERROR` to understand why the flow failed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id from the execution result's `contextId` field. |

### Example Usage

```json
{
  "name": "get_flow_error",
  "arguments": {
    "instance": "myinstance",
    "context_id": "a1b2c3d4e5f6789012345678abcdef01"
  }
}
```

### Example Output

```
=== Flow Error ===
Context ID: a1b2c3d4e5f6789012345678abcdef01
Success: true

Flow Error Message:
The flow "global.my_flow" failed at step 3: Invalid record sys_id provided
```

---

## cancel_flow

Cancel a running or paused flow execution by its context ID. Use this to stop a background flow that is no longer needed, is stuck in a waiting state, or was started by mistake.

> **Warning:** This is a destructive operation — the flow will be permanently cancelled and cannot be resumed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id from the execution result's `contextId` field. |
| `reason` | string | No | `"Cancelled via FlowManager"` | Reason for cancellation. |

### Example Usage

```json
{
  "name": "cancel_flow",
  "arguments": {
    "instance": "myinstance",
    "context_id": "a1b2c3d4e5f6789012345678abcdef01",
    "reason": "No longer needed - test completed"
  }
}
```

### Example Output

```
=== Flow Cancellation ===
Context ID: a1b2c3d4e5f6789012345678abcdef01
Success: true
```

---

## get_flow_definition

Read the design-time definition of a flow, subflow or action as Workflow Studio stores it: trigger, steps, flow logic, inputs and outputs. This is what the artifact *is*; `get_flow_execution_details` is what one run of it did. Nothing runs. The type is never inferred: a sys_id of another type fails (`type_mismatch` or `not_found`).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `sys_id` | string | **Yes** | — | A `sys_hub_flow` sys_id (flow or subflow) or a `sys_hub_action_type_definition` sys_id. |
| `type` | `flow` \| `subflow` \| `action` | No | `flow` | What the sys_id is. |
| `scope` | string | No | — | The application scope to read it in. |
| `view` | `summary` \| `full` | No | `summary` | `summary`: name, scope, state and counts, plus an action's steps. `full`: the whole definition as compact JSON, cut at 80,000 characters. |

The content is returned as data between start and end markers, with secrets redacted.

---

## send_flow_message

Send a message to a paused execution waiting in a Wait For Message step, which resumes it. Sent from a server-side script (`sn_fd.FlowAPI.sendMessage`), so it needs `execute` as well as `write`.

> **Warning:** Only when the user asked. The flow then runs whatever comes next. The platform accepts a message even when nothing is waiting for it, so check `get_flow_context_status` afterwards to see whether the flow resumed.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The `sys_flow_context` sys_id. |
| `message` | string | **Yes** | — | The message the step waits for. No line breaks. |
| `payload` | string | No | — | Passed with the message, on one line (for example minified JSON). |
| `scope` | string | No | global | The scope to run the sending script in. |

---

## Browser sessions (Playwright)

A verified browser session for an alias, as `nex auth browser-session` mints it, for driving the UI with Playwright: core logs in with the alias's stored credential, proves the cookies authenticate without the OAuth token, and the server writes them as a Playwright storage state.

> **Warning:** The session carries the user's full rights in the UI, outside this server's change policy. So `create_browser_session` needs `write` and `execute`, and `NEX_POLICY_DENY` of either refuses it. The cookies are never returned: only the file's path. Never print or commit the file, and delete it when the browser work is done.

| Tool | Does |
|------|------|
| `create_browser_session` | Writes `<name>.json` (0600, never replacing a file) in the session directory and returns its path, the cookie count and the OAuth token's expiry. `name` is letters, digits, `-` and `_`; default the alias and a timestamp. The model never chooses a path. |
| `delete_browser_session` | Deletes a session file, given the path `create_browser_session` returned: only a file in the session directory that is this user's own, 0600, and a Playwright storage state, so nothing else there can be removed. Local cleanup, so it is permitted under any policy. |

The session directory is `NEX_BROWSER_SESSION_DIR` when the server sets it, otherwise a private per-user directory under the system temp directory. Either must be this user's own and closed to others (0700), or every call is refused. Files are created with O_EXCL (never replacing a file or following a link), with no temporary copy. On Windows there is no owner or mode to check, and the per-user temp directory is what keeps the file private.

```js
// Playwright, with the path create_browser_session returned
const context = await browser.newContext({ storageState: "/tmp/nex-browser-sessions-1000/ui-check.json" });
```

---

## Flow debugger

Workflow Studio's **Test > Debug**, as `nex flow debug` drives it. A debug run executes the flow's current draft **for real**: records it creates or changes are kept, so debug a copy (`copy_flow`) in a scratch app. A run is addressed by its root context id; nothing is held in the server, and `list_flow_debug_sessions` finds runs left open. Every run must be ended: run it to the end, or `debug_flow_cancel`.

Starting and stepping need `execute` as well as `write`; breakpoints and cancel need only `write`, so a run can still be cancelled under `NEX_POLICY_DENY=execute`. Calls that move a run are never replayed after a transport error. A wait defaults to 45 seconds, under the 60-second request timeout many clients use; `debug_flow_run_to` waits more than once, so its `timeout_seconds` (default 30, at least 10 so each wait is long enough to reach a breakpoint) is for the whole call and is split across its waits. A client that gives up first leaves the run open: find it with `list_flow_debug_sessions`. Run data (names, step labels, inputs and outputs) is fenced as data and redacted; values over 200 characters are cut unless `full`.

| Tool | Does | Needs |
|------|------|-------|
| `debug_flow_start` | Start a run (`flow`: sys_id or `scope.internal_name`; `inputs`; optional `breakpoints` by step number) and leave it paused before its first step. Returns the context id, the steps it can stop at, and where it is. | execute, write |
| `debug_flow_run_to` | Start, run to the first of `breakpoints`, report every step's inputs and outputs there (or say the run never reached one), then `after`: `cancel` (default), `resume` to the end, or `stay` paused. | execute, write |
| `debug_flow_step` | Move a paused run: `over` (default), `into` a subflow (later calls apply to its child context), `out`, `resume`, or `skip_all`. | execute, write |
| `debug_flow_inspect` | Without moving it: `snapshot` (default), `steps` (every step's inputs and outputs, or one `step`), `locations`, or `breakpoints`. | read |
| `debug_flow_breakpoints` | Exactly one change: `set`, `add` and/or `remove` (not the same step in both), or `clear`. Steps are checked against the debugger's own list; an invalid one is refused with the valid steps. | write |
| `debug_flow_cancel` | End the run and any subflow it stepped into, and read it back. Safe to repeat; refuses a context the debugger did not start, so it cannot end a real flow run. | write |
| `list_flow_debug_sessions` | Runs still open (paused, waiting or running), newest first; optional `created_by` and `limit`. | read |

### Example: one call

```json
{
  "name": "debug_flow_run_to",
  "arguments": {
    "flow": "x_myapp.create_task_copy",
    "inputs": { "table": "incident", "field_values": "short_description=Debug" },
    "breakpoints": [3]
  }
}
```

---

## test_flow

Test a ServiceNow Flow Designer flow without requiring it to be published. This is the **primary tool to use when building and iterating on a flow** — it invokes the same API as the 'Test' button in Flow Designer, running the flow in its current saved (draft) state.

Unlike `execute_flow` (which requires a published flow and uses `sn_fd.FlowAPI`), `test_flow` works on unpublished drafts via the ProcessFlow REST API (`POST /api/now/processflow/flow/{id}/test`).

The tool returns a context ID on success — use `get_flow_context_status` to poll the execution status, then `get_flow_outputs` or `get_flow_error` once complete.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `flow_id` | string | **Yes** | — | Flow sys_id (32-char hex) or scoped name (e.g., `"x_myapp.my_flow"`). The flow does not need to be published. |
| `output_map` | object | **Yes** | — | Maps trigger output variable names to concrete test values. For record-triggered flows: `{ "current": "<record_sys_id>", "table_name": "<table>" }`. Open the flow in Flow Designer and inspect the trigger to see the available variable names. |
| `scope` | string | No | _(auto-resolved from flow definition)_ | Scope sys_id for the transaction scope query parameter. |
| `run_on_thread` | boolean | No | `true` | Whether to run the test synchronously on the current thread. |

> **Determining `output_map` keys:** Open the flow in Flow Designer, click the trigger, and look at the **Outputs** section. Each output variable listed there corresponds to a key in `output_map`. Common patterns:
> - Record-triggered flows: `{ "current": "<sys_id>", "table_name": "<table>" }`
> - Schedule-triggered flows: `{}` (no trigger outputs)

### Example Usage

```json
{
  "name": "test_flow",
  "arguments": {
    "instance": "myinstance",
    "flow_id": "887dda5583237210fdb8f7b6feaad32c",
    "output_map": {
      "current": "0ecd7552db252200a6a2b31be0b8f5e6",
      "table_name": "change_request"
    }
  }
}
```

### Example Output

```
=== Flow Test Result ===
Success: true
Context ID: d4e5f6789012345678abcdef01234567

The test has been submitted. Use get_flow_context_status to poll the execution status, then get_flow_outputs or get_flow_error once complete.
```

---

## copy_flow

Copy an existing ServiceNow Flow Designer flow into a target scoped application. This is the **best-practice first step** when you want to modify any flow — OOB (out-of-box) and shared flows should not be modified directly. Copying into your application scope first keeps the original intact and gives you a flow you own and can freely modify.

This tool enables the full AI-assisted flow development lifecycle:

> **`copy_flow`** → pull with `now-sdk transform` → modify → push → **`test_flow`** → **`publish_flow`**

The copied flow lands in **draft/unpublished state** in the target scope with a new sys_id, fully independent of the source. The tool output includes the exact `now-sdk transform` command to pull the copy locally.

> **Finding `target_scope`:** Use `list_scoped_apps` to find the sys_id of your target application scope. The `target_scope` parameter requires a sys_id, not a scope name string.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `source_flow_id` | string | **Yes** | — | Source flow sys_id (32-char hex) or scoped name (e.g., `"global.change__standard"`). Can be an OOB flow, a flow in global scope, or any scoped flow. |
| `name` | string | **Yes** | — | Display name for the newly created flow copy (e.g., `"Copy of Change - Standard"`). |
| `target_scope` | string | **Yes** | — | Scope sys_id of the target application to copy the flow into. Use `list_scoped_apps` to find this value. |

### Example Usage

```json
{
  "name": "copy_flow",
  "arguments": {
    "instance": "myinstance",
    "source_flow_id": "e89e3ade731310108ef62d2b04f6a744",
    "name": "Copy of Change - Standard",
    "target_scope": "4a5a6115402946939ee48e3fe80f60f8"
  }
}
```

### Example Output

```
=== Flow Copy Result ===
Success: true
New Flow sys_id: 887dda5583237210fdb8f7b6feaad32c

The flow has been copied into your application scope in draft/unpublished state.

Recommended next steps:
1. Pull the flow using: now-sdk transform --flow 887dda5583237210fdb8f7b6feaad32c
2. Modify the pulled source in your project
3. Push your changes back to the instance
4. Test with test_flow
5. Publish with publish_flow when ready
```

---

## get_flow_execution_details

Get rich execution details for a flow context: per-action timing, inputs, outputs, and high-level metadata (state, runtime, who ran it, test vs production).

This is the **primary diagnostic tool** after `test_flow` or `execute_flow` — use it to understand what each action did, identify which step failed, inspect inputs and outputs, and iterate on the flow definition.

Uses the ProcessFlow operations API (`GET /api/now/processflow/operations/flow/context/{id}`), the same endpoint Flow Designer uses to display execution details.

> **Note:** Requires flow operations logging to be enabled on the instance. If the execution report is unavailable, the response will include a notice explaining why.

### Typical Workflow

```
test_flow → get_flow_execution_details → diagnose → modify flow → test_flow again
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id returned by `test_flow`, `execute_flow`, `execute_subflow`, or `execute_action`. |
| `scope` | string | No | — | Scope sys_id for the ProcessFlow API transaction scope parameter. |
| `include_flow_definition` | boolean | No | `false` | Whether to include the full flow definition snapshot in the response. Enable only when you need to inspect the raw flow structure. |

### Example Usage

```json
{
  "name": "get_flow_execution_details",
  "arguments": {
    "instance": "myinstance",
    "context_id": "d4e5f6789012345678abcdef01234567"
  }
}
```

### Example Output

```
=== Flow Execution Details ===
Context ID: d4e5f6789012345678abcdef01234567
Flow: Change - Unauthorized Review
State: COMPLETE
Runtime: 1234ms
Test Run: true
Executed As: admin
Initiated By: admin
Triggered By: TEST_BUTTON
Source Table: change_request
Source Record: CHG0010042

--- Action Results ---
1. Create Incident  [COMPLETE, 120ms]
   Inputs: {"table_name":"Incident"}
   Outputs: {"sys_id":"INC0001234"}
2. Update Record (Assign to Group)  [COMPLETE, 85ms]
   Inputs: {"assignment_group":"Network"}
```

---

## get_flow_logs

Retrieve flow execution log entries from `sys_flow_log` for a given context.

Log entries include error messages, step-level debug output, and cancellation reasons. Use this alongside `get_flow_execution_details` to get the full picture of what happened during an execution.

> **Note:** Log entries may be empty for simple successful executions, or if the flow's reporting level is set to NONE. Errors and warnings are always logged regardless of the reporting level setting.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. |
| `context_id` | string | **Yes** | — | The flow context sys_id returned by `test_flow`, `execute_flow`, `execute_subflow`, or `execute_action`. |
| `limit` | number | No | `100` | Maximum number of log entries to return. |
| `order_direction` | string | No | `"asc"` | Order direction: `"asc"` (oldest first) or `"desc"` (newest first). |

### Example Usage

```json
{
  "name": "get_flow_logs",
  "arguments": {
    "instance": "myinstance",
    "context_id": "d4e5f6789012345678abcdef01234567",
    "limit": 50,
    "order_direction": "desc"
  }
}
```

### Example Output

```
=== Flow Execution Logs ===
Context ID: d4e5f6789012345678abcdef01234567
Entries: 3

[1] INFO  | action.create_record              | Record created: INC0001234 [2024-06-01 12:34:56]
[2] INFO  | action.update_record              | Updated assignment_group [2024-06-01 12:34:57]
[3] ERROR | action.send_notification          | Failed to send email: no recipients found [2024-06-01 12:34:58]
```

# Available Tools

This document lists all MCP tools exposed by the `now-sdk-ext-mcp` server. When adding a new tool, document it here.

---

## execute_script

Execute JavaScript on a ServiceNow instance using Scripts - Background.

The script runs server-side with full GlideSystem API access (`GlideRecord`, `GlideAggregate`, `gs.print()`, `gs.getUser()`, `gs.now()`, and all standard ServiceNow server-side APIs). Use `gs.print()` to produce output. Scripts execute with the permissions of the authenticated user.

> **Warning:** This executes code directly on the ServiceNow instance. Always review scripts before execution and prefer read-only operations unless modification is explicitly intended.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"dev224436"`, `"prod"`). This is the alias configured via `snc configure`. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `script` | string | **Yes** | — | The JavaScript code to execute. Use `gs.print()` to output results. |
| `scope` | string | No | `"global"` | The application scope to execute in. Use `"global"` for global scope, or an app scope like `"x_myapp_custom"`. |
| `params` | object | No | — | Key-value pairs for parameter substitution. Occurrences of `{paramName}` in the script are replaced with the corresponding value. |

### Example Usage

A user asking Claude:

> "Find all active incidents with priority 1 on my dev224436 instance"

Would result in a tool call like:

```json
{
  "name": "execute_script",
  "arguments": {
    "instance": "dev224436",
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
    "instance": "dev224436",
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
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"dev224436"`, `"prod"`). If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `test_sys_id` | string | **Yes** | — | The sys_id of the ATF test to execute (from the `sys_atf_test` table). |

### Example Usage

A user asking Claude:

> "Run the ATF test with sys_id abc123def on my dev224436 instance"

Would result in a tool call like:

```json
{
  "name": "run_atf_test",
  "arguments": {
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias (e.g., `"dev224436"`, `"prod"`). If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
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
    "instance": "dev224436",
    "term": "GlideRecord"
  }
}
```

Search within a specific search group and table:

```json
{
  "name": "code_search",
  "arguments": {
    "instance": "dev224436",
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
    "instance": "dev224436"
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436"
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436"
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
    "instance": "dev224436",
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
| `application` | string | No | — | Optional application scope sys_id to associate the update set with. |

### Example Usage

```json
{
  "name": "create_update_set",
  "arguments": {
    "instance": "dev224436",
    "name": "FEAT-1234 New Catalog Item",
    "description": "Update set for the new hardware catalog item"
  }
}
```

### Example Output

```
Update set created successfully.
sys_id: new123def456789
Name: FEAT-1234 New Catalog Item
State: in progress
```

---

## set_current_update_set

Set the active update set for the session. All subsequent changes will be captured in this update set.

> **Warning:** This changes which update set captures configuration changes made on the instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instance` | string | No | `SN_AUTH_ALIAS` env var | The ServiceNow instance auth alias. If omitted, falls back to the `SN_AUTH_ALIAS` environment variable. |
| `name` | string | **Yes** | — | Name of the update set to set as current. |
| `sys_id` | string | **Yes** | — | sys_id of the update set to set as current. |

### Example Usage

```json
{
  "name": "set_current_update_set",
  "arguments": {
    "instance": "dev224436",
    "name": "FEAT-1234 New Catalog Item",
    "sys_id": "new123def456789"
  }
}
```

### Example Output

```
Current update set changed to "FEAT-1234 New Catalog Item" (new123def456789).
All subsequent changes will be captured in this update set.
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436"
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
    "table": "sys_audit_delete",
    "query": "sys_created_on<javascript:gs.daysAgoStart(365)",
    "confirm": false
  }
}
```

---

## clone_update_set

Clone an existing update set by creating a new one and copying all its records.

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
    "instance": "dev224436",
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
    "instance": "dev224436",
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
    "instance": "dev224436",
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

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

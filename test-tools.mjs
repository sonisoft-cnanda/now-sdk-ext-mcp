#!/usr/bin/env node
/**
 * MCP tool test harness — spawns the server, lists tools, and calls a set of
 * tools against a live ServiceNow instance (auth alias "dev").
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

const INSTANCE = "dev224436";
let msgId = 0;

function send(proc, method, params = {}) {
  const id = ++msgId;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  proc.stdin.write(msg + "\n");
  return id;
}

function waitForResponse(rl, expectedId, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for id=${expectedId}`)),
      timeoutMs
    );
    const onLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.id === expectedId) {
          clearTimeout(timer);
          rl.removeListener("line", onLine);
          resolve(parsed);
        }
      } catch {}
    };
    rl.on("line", onLine);
  });
}

async function callTool(proc, rl, name, args, timeoutMs = 120_000) {
  const id = send(proc, "tools/call", { name, arguments: args });
  return waitForResponse(rl, id, timeoutMs);
}

// ─── Test definitions ───
const tests = [
  { name: "query_table", args: { instance: INSTANCE, table: "incident", query: "active=true", fields: "sys_id,number,short_description", limit: 3 } },
  { name: "lookup_table", args: { instance: INSTANCE, search_term: "incident", limit: 3 } },
  { name: "lookup_columns", args: { instance: INSTANCE, table: "incident", search_term: "cause", limit: 5 } },
  { name: "lookup_app", args: { instance: INSTANCE, search_term: "Global", type: "app", active_only: true } },
  { name: "discover_table_schema", args: { instance: INSTANCE, table: "incident" } },
  { name: "explain_field", args: { instance: INSTANCE, table: "incident", field: "cause" } },
  { name: "list_scoped_apps", args: { instance: INSTANCE, query: "active=true", limit: 5 } },
  { name: "list_update_sets", args: { instance: INSTANCE, query: "state=in progress", limit: 5 } },
  { name: "find_task", args: { instance: INSTANCE, table: "incident", number: "INC0000001" } },
  { name: "query_syslog", args: { instance: INSTANCE, level: "error", limit: 5 } },
  { name: "search_store_apps", args: { instance: INSTANCE, tab_context: "installed", limit: 5 } },
  { name: "search_store_apps (updates)", toolName: "search_store_apps", args: { instance: INSTANCE, tab_context: "updates", limit: 5 } },
  { name: "list_company_apps", args: { instance: INSTANCE } },
  { name: "list_code_search_groups", args: { instance: INSTANCE } },
  { name: "find_atf_tests", args: { instance: INSTANCE, search_term: "incident", limit: 3 } },
  // ─── New tools ───
  { name: "count_records", args: { instance: INSTANCE, table: "incident", query: "active=true" } },
  { name: "aggregate_query", args: { instance: INSTANCE, table: "incident", count: true, avg_fields: ["reassignment_count"] } },
  { name: "aggregate_grouped", args: { instance: INSTANCE, table: "incident", group_by: ["priority"], count: true } },
  { name: "check_instance_health", args: { instance: INSTANCE, include_version: true, include_cluster: true, include_stuck_jobs: true, include_semaphores: true, include_operational_counts: true } },
  { name: "list_instance_tables", args: { instance: INSTANCE, name_prefix: "incident", limit: 10 } },
  { name: "list_plugins", args: { instance: INSTANCE, active_only: true, limit: 10 } },
  { name: "query_update_records (dry-run)", toolName: "query_update_records", args: { instance: INSTANCE, table: "incident", query: "active=true", data: { short_description: "DRY RUN" }, confirm: false } },
  { name: "query_delete_records (dry-run)", toolName: "query_delete_records", args: { instance: INSTANCE, table: "incident", query: "active=false^short_description=NONEXISTENT_XYZ_99999", confirm: false } },
];

// ─── Main ───
async function main() {
  const proc = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SN_AUTH_ALIAS: INSTANCE },
  });

  proc.stderr.on("data", () => {}); // suppress stderr

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  // Initialize
  const initId = send(proc, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-harness", version: "1.0.0" },
  });
  await waitForResponse(rl, initId);
  send(proc, "notifications/initialized", {});

  // List tools
  const listId = send(proc, "tools/list", {});
  const listResp = await waitForResponse(rl, listId);
  const toolNames = (listResp.result?.tools || []).map((t) => t.name);
  console.log(`\n=== ${toolNames.length} tools registered ===\n`);

  // Run tests
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const toolName = t.toolName || t.name;
    const label = `[${i + 1}/${tests.length}] ${t.name}`;
    try {
      const resp = await callTool(proc, rl, toolName, t.args);
      const content = resp.result?.content?.[0]?.text || "";
      const isError = resp.result?.isError || resp.error;
      if (isError) {
        console.log(`FAIL  ${label}`);
        console.log(`      Error: ${content.slice(0, 200)}`);
        failed++;
      } else {
        console.log(`PASS  ${label}`);
        const firstLine = content.split("\n").find((l) => l.trim()) || "";
        console.log(`      ${firstLine.slice(0, 120)}`);
        passed++;
      }
    } catch (err) {
      console.log(`FAIL  ${label}`);
      console.log(`      Exception: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${tests.length} ===\n`);

  proc.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

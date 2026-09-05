import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BEHAVIOR_CATEGORIES, TableBehaviorDiscovery, type BehaviorDetailsResult, type TableBehaviorResult } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";
import { annotationsFor } from "../common/annotations.js";

const controls = {
  instance: z.string().optional().describe("Instance auth alias; defaults to SN_AUTH_ALIAS."),
  details: z.array(z.enum(["scripts", "definitions", "dependencies"])).optional().describe("Include requested details in this call. Default: compact configuration without script bodies or full definitions."),
  dependency_depth: z.union([z.literal(0), z.literal(1)]).optional().describe("Expand one dependency level; requires details containing dependencies. Default 0."),
  max_bytes: z.number().int().min(4096).max(1048576).optional().describe("JSON response budget, default 65536 bytes. Oversized detail is omitted whole with a retrieval reference."),
  scope: z.string().optional().describe("Transaction scope for flow design-definition reads."),
};

function output(result: TableBehaviorResult | BehaviorDetailsResult) {
  const count = "categories" in result ? result.categories.reduce((sum, section) => sum + section.items.length, 0) : result.items.length;
  const partial = "categories" in result ? result.categories.filter(section => section.status !== "complete").map(section => section.category) : [];
  return {
    structuredContent: { ...result },
    content: [{ type: "text" as const, text: `${count} configured behavior item(s). Details and source references are in structuredContent. Conditions were not evaluated.${partial.length ? ` Incomplete categories: ${partial.join(", ")}; inspect warnings and nextCursor.` : ""}${result.warnings.length ? " Inspect top-level warnings for omissions or failed reads." : ""}` }],
  };
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Behavior discovery failed: ${error instanceof Error ? error.message : "Unknown error"}` }] };
}

/** Register read-only discovery with optional immediate detail expansion. */
export function registerDiscoverTableBehaviorTool(server: McpServer): void {
  server.registerTool(
    "discover_table_behavior", {
    title: "Discover Table Behavior",
    annotations: annotationsFor("discover_table_behavior"),
    description: "Discover configuration affecting a table: business rules, UI actions, client scripts, UI policies and field actions, server data policies, workflows, flow triggers and generic state models. Defaults to active behavior and applicable ancestors. Returns conditions, timing, provenance and completeness; configuration is not a prediction that anything will execute. Select categories and request scripts/definitions/dependencies immediately when already needed. Flow runtime triggers and design-time definitions are labeled separately. Follow per-category cursors with the same filters; use get_behavior_details for known references or a targeted batch. Empty results describe this account's visibility only.",
    inputSchema: {
      ...controls,
      table: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).describe("Target table, e.g. incident or change_request."),
      categories: z.array(z.enum(BEHAVIOR_CATEGORIES)).min(1).optional().describe("Categories to inspect; default all eight."),
      include_inherited: z.boolean().optional().describe("Include applicable ancestor behavior; default true."),
      include_inactive: z.boolean().optional().describe("Include inactive/draft candidates where discoverable; default false."),
      name: z.string().optional().describe("Metadata name contains this text."),
      sys_ids: z.array(z.string().regex(/^[a-f0-9]{32}$/i)).max(50).optional().describe("Filter by metadata source sys_ids. For known flow IDs prefer get_behavior_details."),
      limit: z.number().int().min(1).max(200).optional().describe("Items per category; default 50."),
      cursors: z.record(z.enum(BEHAVIOR_CATEGORIES), z.string()).optional().describe("Per-category continuation tokens; retain original filters."),
    },
  }, async ({ instance, table, categories, include_inherited, include_inactive, name, sys_ids, limit, cursors, details, dependency_depth, max_bytes, scope }) => {
    try {
      return output(await withConnectionRetry(instance, sn => new TableBehaviorDiscovery(sn).discoverTableBehavior(table, {
        categories, includeInherited: include_inherited, includeInactive: include_inactive, name, sysIds: sys_ids, limit, cursors,
        details, dependencyDepth: dependency_depth, maxBytes: max_bytes, scope,
      })));
    } catch (error) { return failure(error); }
  });
}

/** Register batched retrieval of known artifacts without inventory scanning. */
export function registerGetBehaviorDetailsTool(server: McpServer): void {
  server.registerTool(
    "get_behavior_details", {
    title: "Get Behavior Details",
    annotations: annotationsFor("get_behavior_details"),
    description: "Read up to 50 known behavior references in one call without rediscovering a table. Pass references from discover_table_behavior or known kind/sourceTable/sysId values. Add details to request scripts, definitions and dependencies immediately; default is compact metadata. Flows accept sourceTable sys_hub_flow with kind flows; subflows, actions, Script Includes and decision tables can also be retrieved. Optional one-level dependency expansion is bounded and labels unresolved calls. Inaccessible and oversized details have explicit warnings and recovery references. This reads configuration only.",
    inputSchema: {
      ...controls,
      references: z.array(z.object({
        kind: z.enum([...BEHAVIOR_CATEGORIES, "subflow", "action", "script_include", "decision_table"]),
        sourceTable: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).describe("Source metadata table from discovery, e.g. sys_script or sys_hub_flow. Core validates allowed kind/table pairs."),
        sysId: z.string().regex(/^[a-f0-9]{32}$/i),
      })).min(1).max(50),
    },
  }, async ({ instance, references, details, dependency_depth, max_bytes, scope }) => {
    try {
      return output(await withConnectionRetry(instance, sn => new TableBehaviorDiscovery(sn).getBehaviorDetails(
        references.map(ref => ({ kind: ref.kind, sourceTable: ref.sourceTable, sysId: ref.sysId })),
        { details, dependencyDepth: dependency_depth, maxBytes: max_bytes, scope },
      )));
    } catch (error) { return failure(error); }
  });
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AggregateQuery } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the count_records tool on the MCP server.
 *
 * Returns a simple count of records matching an optional query on any table.
 */
export function registerCountRecordsTool(server: McpServer): void {
  server.registerTool(
    "count_records",
    {
      title: "Count Records",
      description:
        "Count records on any ServiceNow table, optionally filtered by an encoded query. " +
        "Uses the Stats API for efficient server-side counting — much faster than querying " +
        "all records and counting client-side.\n\n" +
        "Use this to quickly gauge data volumes (e.g., how many open P1 incidents, " +
        "how many users in a group, how many CIs of a given class).",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            'The ServiceNow table name to count records on (e.g., "incident", ' +
              '"sys_user", "cmdb_ci_server").'
          ),
        query: z
          .string()
          .optional()
          .describe(
            "An encoded query string to filter which records are counted. " +
              'Examples: "active=true^priority=1", "state!=7". ' +
              "If omitted, counts all records in the table."
          ),
      },
    },
    async ({ instance, table, query }) => {
      try {
        const count = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const agg = new AggregateQuery(snInstance);
            return await agg.count({ table, query });
          }
        );

        const lines: string[] = [];
        lines.push("=== Record Count ===");
        lines.push(`Table: ${table}`);
        if (query) lines.push(`Query: ${query}`);
        lines.push(`Count: ${count}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text" as const, text: `Error counting records: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the aggregate_query tool on the MCP server.
 *
 * Runs aggregate functions (COUNT, AVG, MIN, MAX, SUM) on a table without grouping.
 */
export function registerAggregateQueryTool(server: McpServer): void {
  server.registerTool(
    "aggregate_query",
    {
      title: "Aggregate Query",
      description:
        "Run aggregate functions (COUNT, AVG, MIN, MAX, SUM) on any ServiceNow table " +
        "using the Stats API. Returns computed statistics without returning individual records.\n\n" +
        "Examples: average resolution time for incidents, max priority across open changes, " +
        "sum of story points in a sprint, count of active users.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            'The ServiceNow table name (e.g., "incident", "change_request").'
          ),
        query: z
          .string()
          .optional()
          .describe(
            "An encoded query string to filter records before aggregation. " +
              "If omitted, aggregates over all records."
          ),
        count: z
          .boolean()
          .optional()
          .describe("When true, include a COUNT in the results."),
        avg_fields: z
          .array(z.string())
          .optional()
          .describe(
            'Field names to compute AVG on (e.g., ["reassignment_count", "reopen_count"]).'
          ),
        min_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute MIN on."),
        max_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute MAX on."),
        sum_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute SUM on."),
        display_value: z
          .enum(["true", "false", "all"])
          .optional()
          .describe(
            'Display value handling: "true" returns display values, "false" returns ' +
              'internal values, "all" returns both. If omitted, returns internal values.'
          ),
      },
    },
    async ({
      instance,
      table,
      query,
      count,
      avg_fields,
      min_fields,
      max_fields,
      sum_fields,
      display_value,
    }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const agg = new AggregateQuery(snInstance);
            return await agg.aggregate({
              table,
              query,
              count,
              avgFields: avg_fields,
              minFields: min_fields,
              maxFields: max_fields,
              sumFields: sum_fields,
              displayValue: display_value,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Aggregate Results ===");
        lines.push(`Table: ${table}`);
        if (query) lines.push(`Query: ${query}`);
        lines.push("");
        lines.push("Stats:");
        lines.push(JSON.stringify(result.stats, null, 2));

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running aggregate query: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the aggregate_grouped tool on the MCP server.
 *
 * Runs aggregate functions with GROUP BY to produce per-group breakdowns.
 */
export function registerAggregateGroupedTool(server: McpServer): void {
  server.registerTool(
    "aggregate_grouped",
    {
      title: "Grouped Aggregate Query",
      description:
        "Run aggregate functions (COUNT, AVG, MIN, MAX, SUM) grouped by a field on any " +
        "ServiceNow table. Returns per-group statistics — ideal for breakdowns and dashboards.\n\n" +
        "Examples: count of incidents grouped by priority, average resolution time grouped " +
        "by category, sum of story points grouped by assignee.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        table: z
          .string()
          .describe(
            'The ServiceNow table name (e.g., "incident", "change_request").'
          ),
        group_by: z
          .array(z.string())
          .describe(
            'The field name(s) to group by (e.g., ["priority"], ["state", "category"]). ' +
              "Pass a single-element array for simple grouping."
          ),
        query: z
          .string()
          .optional()
          .describe(
            "An encoded query string to filter records before aggregation."
          ),
        count: z
          .boolean()
          .optional()
          .describe("When true, include a COUNT per group."),
        avg_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute AVG on per group."),
        min_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute MIN on per group."),
        max_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute MAX on per group."),
        sum_fields: z
          .array(z.string())
          .optional()
          .describe("Field names to compute SUM on per group."),
        having: z
          .string()
          .optional()
          .describe(
            "A HAVING clause to filter groups after aggregation " +
              '(e.g., "COUNT>10" to only return groups with more than 10 records).'
          ),
        display_value: z
          .enum(["true", "false", "all"])
          .optional()
          .describe(
            'Display value handling: "true" returns display values, "false" returns ' +
              'internal values, "all" returns both.'
          ),
      },
    },
    async ({
      instance,
      table,
      group_by,
      query,
      count,
      avg_fields,
      min_fields,
      max_fields,
      sum_fields,
      having,
      display_value,
    }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const agg = new AggregateQuery(snInstance);
            return await agg.groupBy({
              table,
              groupBy: group_by,
              query,
              count,
              avgFields: avg_fields,
              minFields: min_fields,
              maxFields: max_fields,
              sumFields: sum_fields,
              having,
              displayValue: display_value,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Grouped Aggregate Results ===");
        lines.push(`Table: ${table}`);
        lines.push(`Group By: ${group_by.join(", ")}`);
        if (query) lines.push(`Query: ${query}`);
        lines.push(`Groups returned: ${result.groups.length}`);

        for (const group of result.groups) {
          lines.push("");
          lines.push(`--- Group ---`);
          if (group.groupby_fields) {
            for (const field of group.groupby_fields) {
              lines.push(`  ${field.field}: ${field.value}`);
            }
          }
          lines.push(`  Stats: ${JSON.stringify(group.stats)}`);
        }

        lines.push("");
        lines.push(`=== ${result.groups.length} group(s) returned ===`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running grouped aggregate: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TableAPIRequest } from "@sonisoft/now-sdk-ext-core";
import {
  withConnectionRetry,
  isRetryableResponse,
} from "../common/connection.js";

interface TableResponse {
  result: Record<string, unknown>[];
}

/**
 * Registers the query_table tool on the MCP server.
 *
 * General-purpose tool for querying any ServiceNow table via the Table API.
 */
export function registerQueryTableTool(server: McpServer): void {
  server.registerTool(
    "query_table",
    {
      title: "Query ServiceNow Table",
      description:
        "Query any ServiceNow table using the Table API. Returns records matching " +
        "the specified criteria. Supports encoded query strings, field selection, " +
        "and display value resolution.\n\n" +
        "Use this for general-purpose data retrieval from any table (incident, " +
        "sys_user, cmdb_ci, change_request, etc.).",
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
            "The ServiceNow table name to query (e.g., \"incident\", " +
            '"sys_user", "cmdb_ci_server"). This is the internal ' +
            "table name, not the label."
          ),
        query: z
          .string()
          .optional()
          .describe(
            "A ServiceNow encoded query string to filter records. " +
            'Examples: "active=true^priority=1", ' +
            '"short_descriptionLIKEnetwork^state!=7", ' +
            '"sys_created_on>javascript:gs.daysAgoStart(7)". ' +
            "If omitted, returns all records up to the limit."
          ),
        fields: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of field names to return (e.g., " +
            '"sys_id,number,short_description,state"). ' +
            "If omitted, all fields are returned. Specifying fields " +
            "improves performance and readability."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(20)
          .describe(
            "Maximum number of records to return. Default is 20, max is 1000."
          ),
        display_value: z
          .boolean()
          .default(false)
          .describe(
            "When true, returns display values instead of internal values for " +
            "reference and choice fields. For example, assignment_group returns " +
            "the group name instead of the sys_id."
          ),
      },
    },
    async ({ instance, table, query, fields, limit, display_value }) => {
      try {
        const response = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const tableApi = new TableAPIRequest(snInstance);

            const queryParams: Record<string, string | number> = {
              sysparm_limit: limit,
            };
            if (query) queryParams.sysparm_query = query;
            if (fields) queryParams.sysparm_fields = fields;
            if (display_value) queryParams.sysparm_display_value = "true";

            const resp = await tableApi.get<TableResponse>(table, queryParams);

            // If the response looks like a dead session, throw so
            // withConnectionRetry can evict the cache and retry.
            if (isRetryableResponse(resp)) {
              const status = resp?.status ?? "unknown";
              const statusText = resp?.statusText ?? "No response";
              throw new Error(
                `HTTP ${status} ${statusText} querying table "${table}"`
              );
            }

            return resp;
          }
        );

        if (response.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying table "${table}": HTTP ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }

        const records = response.bodyObject?.result ?? [];
        const lines: string[] = [];

        lines.push("=== Query Results ===");
        lines.push(`Table: ${table}`);
        if (query) lines.push(`Query: ${query}`);
        if (fields) lines.push(`Fields: ${fields}`);
        lines.push(`Records returned: ${records.length}`);

        if (records.length === 0) {
          lines.push("");
          lines.push("No records found matching the query.");
        } else {
          records.forEach((record, index) => {
            lines.push("");
            lines.push(`--- Record ${index + 1} ---`);
            lines.push(JSON.stringify(record, null, 2));
          });
        }

        lines.push("");
        lines.push(`=== ${records.length} record(s) returned ===`);

        return {
          content: [
            {
              type: "text" as const,
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error querying table: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

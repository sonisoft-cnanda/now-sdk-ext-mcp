import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TableAPIRequest } from "@sonisoft/now-sdk-ext-core";
import {
  withConnectionRetry,
  isRetryableResponse,
} from "../common/connection.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Coerce any Table API field value to a plain string.
 *
 * With `sysparm_display_value=true`, non-reference fields come back as
 * strings, but reference fields arrive as `{ display_value, link }`.
 * This helper normalises both shapes to a string.
 */
function str(field: any): string {
  if (field == null) return "";
  if (typeof field === "string") return field;
  if (typeof field === "object" && "display_value" in field) {
    return String(field.display_value ?? "");
  }
  return String(field);
}

interface SysDbObjectRecord {
  sys_id: any;
  name: any;
  label: any;
  super_class: any;
  is_extendable: any;
  number_ref: any;
  sys_scope: any;
}

interface SysDbObjectResponse {
  result: SysDbObjectRecord[];
}

/**
 * Registers the lookup_table tool on the MCP server.
 *
 * Searches sys_db_object (the ServiceNow table registry) by table name
 * or label. Useful for validating table names before using them in
 * query_table, execute_script, or other tools.
 */
export function registerLookupTableTool(server: McpServer): void {
  server.registerTool(
    "lookup_table",
    {
      title: "Lookup Table",
      description:
        "Search for ServiceNow tables by name or label. Queries the sys_db_object table " +
        "to find and validate table names.\n\n" +
        "Use this tool to:\n" +
        "- Verify a table name exists before using it with query_table or in GlideRecord scripts\n" +
        "- Discover the correct internal name for a table when you only know the display label\n" +
        "- Find related tables (e.g., search \"incident\" to see incident, incident_alert, etc.)\n" +
        "- Check table hierarchy (which table a table extends)\n\n" +
        "Returns: table name (internal), label (display), parent table, " +
        "whether it is extendable, number prefix, and application scope.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        search_term: z
          .string()
          .describe(
            "Table name or label to search for. Case-insensitive partial matching (contains). " +
              'Examples: "incident", "cmdb_ci", "Change Request".'
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(25)
          .describe("Maximum number of results to return. Default is 25, max is 100."),
      },
    },
    async ({ instance, search_term, limit }) => {
      try {
        const response = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const tableApi = new TableAPIRequest(snInstance);

            // ^NQ OR grouping: search by internal name or display label
            const query =
              `nameLIKE${search_term}` +
              `^NQlabelLIKE${search_term}` +
              `^ORDERBYname`;

            const resp = await tableApi.get<SysDbObjectResponse>(
              "sys_db_object",
              {
                sysparm_query: query,
                sysparm_fields:
                  "sys_id,name,label,super_class,is_extendable,number_ref,sys_scope",
                sysparm_limit: limit,
                sysparm_display_value: "all",
              }
            );

            if (isRetryableResponse(resp)) {
              const status = resp?.status ?? "unknown";
              throw new Error(`HTTP ${status} querying sys_db_object`);
            }

            return resp;
          }
        );

        if (response.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying tables: HTTP ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }

        const tables = response.bodyObject?.result ?? [];

        const lines: string[] = [];
        lines.push("=== Table Search Results ===");
        lines.push(`Search: "${search_term}"`);
        lines.push(`Found: ${tables.length} table(s)`);

        if (tables.length === 0) {
          lines.push("");
          lines.push(
            "No tables found matching your search. " +
              "Try a shorter or different search term."
          );
        } else {
          tables.forEach((table, index) => {
            const name = str(table.name);
            const label = str(table.label);
            const sysId = str(table.sys_id);
            const parent = str(table.super_class);
            const extendable = str(table.is_extendable);
            const numberRef = str(table.number_ref);
            const scope = str(table.sys_scope);

            lines.push("");
            lines.push(
              `${index + 1}. ${name}` + (label ? ` (${label})` : "")
            );
            lines.push(`   sys_id: ${sysId}`);
            if (parent) {
              lines.push(`   Extends: ${parent}`);
            }
            lines.push(`   Extendable: ${extendable || "false"}`);
            if (numberRef) {
              lines.push(`   Number prefix: ${numberRef}`);
            }
            if (scope) {
              lines.push(`   Scope: ${scope}`);
            }
          });

          lines.push("");
          lines.push(
            "Tip: Use the table name (not label) with query_table or in GlideRecord scripts. " +
              "Use lookup_columns to see the columns available on a table."
          );
        }

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
              text: `Error looking up tables: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

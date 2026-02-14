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

interface SysDictionaryRecord {
  element: any;
  column_label: any;
  internal_type: any;
  max_length: any;
  reference: any;
  mandatory: any;
  active: any;
  read_only: any;
  default_value: any;
}

interface SysDictionaryResponse {
  result: SysDictionaryRecord[];
}

/**
 * Registers the lookup_columns tool on the MCP server.
 *
 * Searches sys_dictionary for columns on a specific table. Useful for
 * validating column names and discovering available fields before
 * building queries or scripts.
 */
export function registerLookupColumnsTool(server: McpServer): void {
  server.registerTool(
    "lookup_columns",
    {
      title: "Lookup Table Columns",
      description:
        "List or search columns (fields) on a ServiceNow table. Queries the sys_dictionary " +
        "table to find column names, types, and metadata for a given table.\n\n" +
        "Use this tool to:\n" +
        "- List all columns on a table to see what fields are available\n" +
        "- Validate a column name before using it in a query or script\n" +
        "- Find the correct internal element name when you only know the display label\n" +
        "- Check column types, whether a field is mandatory, read-only, or a reference\n\n" +
        "Returns: element name (internal), column label (display), type, " +
        "max length, reference target, mandatory/read-only/active flags.",
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
            "The internal table name to look up columns for (e.g., " +
              '"incident", "cmdb_ci_server", "sys_user"). ' +
              "Use lookup_table first if you are unsure of the exact table name."
          ),
        search_term: z
          .string()
          .optional()
          .describe(
            "Optional filter to search columns by element name or label. " +
              "Case-insensitive partial matching (contains). " +
              'Examples: "assigned", "priority", "sys_created". ' +
              "If omitted, returns all columns on the table."
          ),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe(
            "Maximum number of columns to return. Default is 50, max is 200."
          ),
      },
    },
    async ({ instance, table, search_term, limit }) => {
      try {
        const response = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const tableApi = new TableAPIRequest(snInstance);

            // Base filter: columns for this table, excluding the
            // "collection" row which is the table definition itself.
            const base = `name=${table}^internal_type!=collection`;

            let query: string;
            if (search_term) {
              // ^NQ OR grouping: search by element name or column label
              query =
                `${base}^elementLIKE${search_term}` +
                `^NQ${base}^column_labelLIKE${search_term}` +
                `^ORDERBYelement`;
            } else {
              query = `${base}^ORDERBYelement`;
            }

            const resp = await tableApi.get<SysDictionaryResponse>(
              "sys_dictionary",
              {
                sysparm_query: query,
                sysparm_fields:
                  "element,column_label,internal_type,max_length,reference,mandatory,active,read_only,default_value",
                sysparm_limit: limit,
                sysparm_display_value: "true",
              }
            );

            if (isRetryableResponse(resp)) {
              const status = resp?.status ?? "unknown";
              throw new Error(`HTTP ${status} querying sys_dictionary`);
            }

            return resp;
          }
        );

        if (response.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying columns: HTTP ${response.status} ${response.statusText}`,
              },
            ],
            isError: true,
          };
        }

        const columns = response.bodyObject?.result ?? [];

        const lines: string[] = [];
        lines.push(`=== Columns for table: ${table} ===`);
        if (search_term) {
          lines.push(`Search: "${search_term}"`);
        }
        lines.push(`Found: ${columns.length} column(s)`);

        if (columns.length === 0) {
          lines.push("");
          if (search_term) {
            lines.push(
              `No columns matching "${search_term}" found on table "${table}". ` +
                "Try a shorter search term or omit it to see all columns."
            );
          } else {
            lines.push(
              `No columns found for table "${table}". ` +
                "Verify the table name is correct using lookup_table."
            );
          }
        } else {
          columns.forEach((col, index) => {
            const element = str(col.element);
            const label = str(col.column_label);
            const type = str(col.internal_type);
            const ref = str(col.reference);
            const mandatory = str(col.mandatory);
            const readOnly = str(col.read_only);
            const active = str(col.active);

            lines.push("");
            lines.push(
              `${index + 1}. ${element}` + (label ? ` (${label})` : "")
            );

            // Type line — include reference target when applicable
            let typeLine = `   Type: ${type}`;
            if (ref) {
              typeLine += ` -> ${ref}`;
            }
            lines.push(typeLine);

            lines.push(
              `   Mandatory: ${mandatory || "false"} | ` +
                `Read-only: ${readOnly || "false"} | ` +
                `Active: ${active || "true"}`
            );

            if (col.max_length) {
              lines.push(`   Max length: ${str(col.max_length)}`);
            }
            if (col.default_value) {
              lines.push(`   Default: ${str(col.default_value)}`);
            }
          });

          lines.push("");
          lines.push(
            "Tip: Use column element names (left of parentheses) in encoded queries, " +
              "GlideRecord scripts, and the fields parameter of query_table."
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
              text: `Error looking up columns: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

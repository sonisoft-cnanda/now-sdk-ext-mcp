import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QueryBatchOperations } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the query_update_records tool on the MCP server.
 *
 * Finds records matching an encoded query and updates them in bulk.
 * Supports dry-run mode (confirm=false) to preview affected records before committing.
 */
export function registerQueryUpdateRecordsTool(server: McpServer): void {
  server.registerTool(
    "query_update_records",
    {
      title: "Query Update Records",
      description:
        "Find records matching an encoded query and update them all with the specified data. " +
        "Supports a dry-run mode: set confirm=false (the default) to see how many records " +
        "would be affected WITHOUT making changes, then set confirm=true to execute.\n\n" +
        "IMPORTANT: When confirm=true, this modifies records on the ServiceNow instance. " +
        "Always run a dry-run first to verify the match count before committing.",
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
            'The ServiceNow table to update records on (e.g., "incident", "sys_user").'
          ),
        query: z
          .string()
          .describe(
            "An encoded query string to find records to update. " +
              'Examples: "active=true^priority=5", "state=1^assignment_group=NULL".'
          ),
        data: z
          .record(z.unknown())
          .describe(
            'Field values to set on all matching records (e.g., {"priority": "3", "state": "2"}).'
          ),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            "When false (default), performs a dry-run that returns the match count " +
              "without making changes. Set to true to actually execute the updates."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Maximum number of records to update. If omitted, updates all matches."
          ),
      },
    },
    async ({ instance, table, query, data, confirm, limit }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const qb = new QueryBatchOperations(snInstance);
            return await qb.queryUpdate({
              table,
              query,
              data,
              confirm,
              limit,
            });
          }
        );

        const lines: string[] = [];
        if (result.dryRun) {
          lines.push("=== Query Update — DRY RUN ===");
          lines.push(`Table: ${table}`);
          lines.push(`Query: ${query}`);
          lines.push(`Records that would be updated: ${result.matchCount}`);
          lines.push("");
          lines.push(
            "No changes were made. Set confirm=true to execute the update."
          );
        } else {
          lines.push("=== Query Update Results ===");
          lines.push(`Table: ${table}`);
          lines.push(`Query: ${query}`);
          lines.push(`Success: ${result.success}`);
          lines.push(`Matched: ${result.matchCount}`);
          lines.push(`Updated: ${result.updatedCount}`);
          lines.push(`Execution Time: ${result.executionTimeMs}ms`);

          if (result.errors && result.errors.length > 0) {
            lines.push("");
            lines.push("Errors:");
            for (const err of result.errors) {
              lines.push(`  ${JSON.stringify(err)}`);
            }
          }
        }

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
              text: `Error in query update: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the query_delete_records tool on the MCP server.
 *
 * Finds records matching an encoded query and deletes them in bulk.
 * Supports dry-run mode (confirm=false) to preview affected records before committing.
 */
export function registerQueryDeleteRecordsTool(server: McpServer): void {
  server.registerTool(
    "query_delete_records",
    {
      title: "Query Delete Records",
      description:
        "Find records matching an encoded query and delete them all. " +
        "Supports a dry-run mode: set confirm=false (the default) to see how many records " +
        "would be deleted WITHOUT making changes, then set confirm=true to execute.\n\n" +
        "IMPORTANT: When confirm=true, this PERMANENTLY DELETES records on the ServiceNow " +
        "instance. Always run a dry-run first to verify the match count before committing. " +
        "This operation cannot be undone.",
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
            'The ServiceNow table to delete records from (e.g., "incident", "sys_user").'
          ),
        query: z
          .string()
          .describe(
            "An encoded query string to find records to delete. " +
              'Examples: "active=false^sys_created_on<javascript:gs.daysAgoStart(365)".'
          ),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            "When false (default), performs a dry-run that returns the match count " +
              "without deleting anything. Set to true to actually execute the deletes."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Maximum number of records to delete. If omitted, deletes all matches."
          ),
      },
    },
    async ({ instance, table, query, confirm, limit }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const qb = new QueryBatchOperations(snInstance);
            return await qb.queryDelete({
              table,
              query,
              confirm,
              limit,
            });
          }
        );

        const lines: string[] = [];
        if (result.dryRun) {
          lines.push("=== Query Delete — DRY RUN ===");
          lines.push(`Table: ${table}`);
          lines.push(`Query: ${query}`);
          lines.push(`Records that would be deleted: ${result.matchCount}`);
          lines.push("");
          lines.push(
            "No records were deleted. Set confirm=true to execute the deletion."
          );
        } else {
          lines.push("=== Query Delete Results ===");
          lines.push(`Table: ${table}`);
          lines.push(`Query: ${query}`);
          lines.push(`Success: ${result.success}`);
          lines.push(`Matched: ${result.matchCount}`);
          lines.push(`Deleted: ${result.deletedCount}`);
          lines.push(`Execution Time: ${result.executionTimeMs}ms`);

          if (result.errors && result.errors.length > 0) {
            lines.push("");
            lines.push("Errors:");
            for (const err of result.errors) {
              lines.push(`  ${JSON.stringify(err)}`);
            }
          }
        }

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
              text: `Error in query delete: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

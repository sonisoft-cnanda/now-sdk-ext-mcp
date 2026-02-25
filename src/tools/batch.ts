import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BatchOperations } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the batch_create_records tool on the MCP server.
 *
 * Creates multiple records across one or more tables in a single batch.
 * Supports variable references between operations for chaining.
 */
export function registerBatchCreateRecordsTool(server: McpServer): void {
  server.registerTool(
    "batch_create_records",
    {
      title: "Batch Create Records",
      description:
        "Create multiple records across one or more ServiceNow tables in a single batch. " +
        "Operations execute sequentially, supporting variable references between them: " +
        "use `saveAs` to name an operation's result sys_id, then reference it in later " +
        "operations with `${name}` in data values.\n\n" +
        "Example: Create a parent record with saveAs='parent', then create a child " +
        "record with caller_id set to '${parent}'.\n\n" +
        "IMPORTANT: This creates records on the ServiceNow instance. Review the " +
        "operations before executing.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        operations: z
          .array(
            z.object({
              table: z.string().describe("Target table name (e.g., 'incident')"),
              data: z
                .record(z.unknown())
                .describe("Field data for the new record"),
              saveAs: z
                .string()
                .optional()
                .describe(
                  "Key to save the created sys_id under. " +
                    "Later operations can reference it via ${key}."
                ),
            })
          )
          .describe("Ordered list of create operations to execute."),
        transaction: z
          .boolean()
          .default(true)
          .describe(
            "When true (default), stops on first error. " +
              "When false, continues past errors."
          ),
      },
    },
    async ({ instance, operations, transaction }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const batchOps = new BatchOperations(snInstance);
            return await batchOps.batchCreate({ operations, transaction });
          }
        );

        const lines: string[] = [];
        lines.push("=== Batch Create Results ===");
        lines.push(`Success: ${result.success}`);
        lines.push(`Created: ${result.createdCount}/${operations.length}`);
        lines.push(`Execution Time: ${result.executionTimeMs}ms`);

        if (Object.keys(result.sysIds).length > 0) {
          lines.push("");
          lines.push("Saved sys_ids:");
          for (const [key, sysId] of Object.entries(result.sysIds)) {
            lines.push(`  ${key}: ${sysId}`);
          }
        }

        if (result.errors.length > 0) {
          lines.push("");
          lines.push("Errors:");
          for (const err of result.errors) {
            lines.push(
              `  Operation ${err.operationIndex + 1} (${err.table}): ${err.error}`
            );
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
            { type: "text" as const, text: `Error in batch create: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the batch_update_records tool on the MCP server.
 *
 * Updates multiple records across one or more tables in a single batch.
 */
export function registerBatchUpdateRecordsTool(server: McpServer): void {
  server.registerTool(
    "batch_update_records",
    {
      title: "Batch Update Records",
      description:
        "Update multiple records across one or more ServiceNow tables in a single batch. " +
        "Each update specifies a table, sys_id, and the field data to update.\n\n" +
        "IMPORTANT: This modifies records on the ServiceNow instance.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        updates: z
          .array(
            z.object({
              table: z.string().describe("Target table name"),
              sysId: z.string().describe("sys_id of the record to update"),
              data: z
                .record(z.unknown())
                .describe("Field data to update"),
            })
          )
          .describe("Ordered list of update operations to execute."),
        stop_on_error: z
          .boolean()
          .default(false)
          .describe(
            "When true, stops on first error. " +
              "When false (default), continues past errors."
          ),
      },
    },
    async ({ instance, updates, stop_on_error }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const batchOps = new BatchOperations(snInstance);
            return await batchOps.batchUpdate({
              updates,
              stopOnError: stop_on_error,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Batch Update Results ===");
        lines.push(`Success: ${result.success}`);
        lines.push(`Updated: ${result.updatedCount}/${updates.length}`);
        lines.push(`Execution Time: ${result.executionTimeMs}ms`);

        if (result.errors.length > 0) {
          lines.push("");
          lines.push("Errors:");
          for (const err of result.errors) {
            lines.push(
              `  Update ${err.updateIndex + 1} (${err.table}/${err.sysId}): ${err.error}`
            );
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
              text: `Error in batch update: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { XMLRecordManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Instance parameter description shared across XML record tools.
 */
const INSTANCE_DESC =
  "The ServiceNow instance auth alias to use. " +
  'This is the alias configured via `now-sdk auth --add` (e.g., "dev224436", "prod", "test"). ' +
  'The user will typically refer to this by name when saying things like "on my dev224436 instance". ' +
  "If not provided, falls back to the SN_AUTH_ALIAS environment variable.";

// ============================================================
// 1. export_record_xml
// ============================================================

/**
 * Registers the export_record_xml tool on the MCP server.
 *
 * Exports a single record as ServiceNow unload XML format via the
 * /<table>.do?UNL endpoint.
 */
export function registerExportRecordXmlTool(server: McpServer): void {
  server.registerTool(
    "export_record_xml",
    {
      title: "Export Record as XML",
      description:
        "Export a single record from a ServiceNow instance in unload XML format. " +
        "Uses the /<table>.do?UNL endpoint to generate ServiceNow-native XML that " +
        "can be imported into another instance or used as a configuration backup.\n\n" +
        "Common use cases:\n" +
        "- Backing up a Script Include, Business Rule, or other configuration record\n" +
        "- Exporting a record to transfer it to another instance\n" +
        "- Comparing record definitions across instances\n" +
        "- Generating XML for inclusion in an update set",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        table: z
          .string()
          .describe(
            "The table name of the record to export (e.g., 'sys_script_include', " +
            "'sys_script', 'incident', 'sys_ui_page', 'kb_knowledge')."
          ),
        sys_id: z
          .string()
          .describe("The sys_id of the record to export."),
      },
    },
    async ({ instance, table, sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new XMLRecordManager(snInstance);
          return await mgr.exportRecord({ table, sysId: sys_id });
        });

        const summary =
          `Exported record from ${result.table}/${result.sysId}` +
          (result.unloadDate ? ` (unload date: ${result.unloadDate})` : "") +
          ` — ${Buffer.byteLength(result.xml, "utf8")} bytes of XML`;

        return {
          content: [
            {
              type: "text" as const,
              text: summary + "\n\n" + result.xml,
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
              text: `Error exporting record: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ============================================================
// 2. import_records_xml
// ============================================================

/**
 * Registers the import_records_xml tool on the MCP server.
 *
 * Imports XML records into ServiceNow via the sys_upload.do processor.
 */
export function registerImportRecordsXmlTool(server: McpServer): void {
  server.registerTool(
    "import_records_xml",
    {
      title: "Import Records from XML",
      description:
        "Import XML records into a ServiceNow instance via the sys_upload.do processor. " +
        "Accepts ServiceNow unload XML format (the output of export_record_xml or " +
        "update set XML exports).\n\n" +
        "IMPORTANT: This is a mutative operation that creates or updates records on the " +
        "instance. Always verify the XML content and target table before importing. " +
        "Use this for restoring configurations, migrating records between instances, " +
        "or applying exported record definitions.",
      inputSchema: {
        instance: z.string().optional().describe(INSTANCE_DESC),
        xml_content: z
          .string()
          .describe(
            "The XML content to import in ServiceNow unload format. This is typically " +
            "the output from export_record_xml or an XML update set export."
          ),
        target_table: z
          .string()
          .describe(
            "The target table to import the records into (e.g., 'sys_script_include', " +
            "'sys_script', 'incident'). Must match the table in the XML content."
          ),
      },
    },
    async ({ instance, xml_content, target_table }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const mgr = new XMLRecordManager(snInstance);
          return await mgr.importRecords({
            xmlContent: xml_content,
            targetTable: target_table,
          });
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Import failed for records into table '${result.targetTable}'.`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully imported records into table '${result.targetTable}'.`,
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
              text: `Error importing records: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

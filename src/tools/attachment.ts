import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AttachmentManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the list_attachments tool on the MCP server.
 *
 * Lists attachments on a ServiceNow record.
 */
export function registerListAttachmentsTool(server: McpServer): void {
  server.registerTool(
    "list_attachments",
    {
      title: "List Attachments",
      description:
        "List file attachments on a ServiceNow record. Returns metadata for each " +
        "attachment including file name, content type, and size.\n\n" +
        "Use this to discover what files are attached to incidents, changes, " +
        "catalog items, or any other record.",
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
            'The table name the record belongs to (e.g., "incident", "change_request").'
          ),
        record_sys_id: z
          .string()
          .describe("The sys_id of the record to list attachments for."),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe("Maximum number of attachments to return. Default 50."),
      },
    },
    async ({ instance, table, record_sys_id, limit }) => {
      try {
        const attachments = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new AttachmentManager(snInstance);
            return await mgr.listAttachments({
              tableName: table,
              recordSysId: record_sys_id,
              limit,
            });
          }
        );

        const lines: string[] = [];
        lines.push(`=== Attachments on ${table}/${record_sys_id} ===`);
        lines.push(`Found: ${attachments.length} attachment(s)`);

        if (attachments.length === 0) {
          lines.push("");
          lines.push("No attachments found on this record.");
        } else {
          for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            lines.push("");
            lines.push(`${i + 1}. ${att.file_name || "unnamed"}`);
            lines.push(`   sys_id: ${att.sys_id}`);
            if (att.content_type) lines.push(`   Type: ${att.content_type}`);
            if (att.size_bytes) lines.push(`   Size: ${att.size_bytes} bytes`);
            if (att.sys_created_on)
              lines.push(`   Created: ${att.sys_created_on}`);
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
              text: `Error listing attachments: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the get_attachment_info tool on the MCP server.
 *
 * Gets metadata for a specific attachment by sys_id.
 */
export function registerGetAttachmentInfoTool(server: McpServer): void {
  server.registerTool(
    "get_attachment_info",
    {
      title: "Get Attachment Info",
      description:
        "Get metadata for a specific attachment by its sys_id. Returns file name, " +
        "content type, size, and the record it is attached to.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        sys_id: z
          .string()
          .describe("The sys_id of the attachment to retrieve."),
      },
    },
    async ({ instance, sys_id }) => {
      try {
        const att = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new AttachmentManager(snInstance);
            return await mgr.getAttachment(sys_id);
          }
        );

        const lines: string[] = [];
        lines.push("=== Attachment Info ===");
        lines.push(`File Name: ${att.file_name || "unnamed"}`);
        lines.push(`sys_id: ${att.sys_id}`);
        if (att.table_name) lines.push(`Table: ${att.table_name}`);
        if (att.table_sys_id) lines.push(`Record: ${att.table_sys_id}`);
        if (att.content_type) lines.push(`Content Type: ${att.content_type}`);
        if (att.size_bytes) lines.push(`Size: ${att.size_bytes} bytes`);
        if (att.sys_created_on) lines.push(`Created: ${att.sys_created_on}`);
        if (att.sys_created_by) lines.push(`Created By: ${att.sys_created_by}`);

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
              text: `Error getting attachment info: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the upload_attachment tool on the MCP server.
 *
 * Uploads a file attachment to a ServiceNow record.
 */
export function registerUploadAttachmentTool(server: McpServer): void {
  server.registerTool(
    "upload_attachment",
    {
      title: "Upload Attachment",
      description:
        "Upload a file attachment to a ServiceNow record. The file content must be " +
        "provided as a base64-encoded string.\n\n" +
        "IMPORTANT: This creates an attachment on the ServiceNow instance.",
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
            'The table name the record belongs to (e.g., "incident", "change_request").'
          ),
        record_sys_id: z
          .string()
          .describe("The sys_id of the record to attach the file to."),
        file_name: z
          .string()
          .describe('The file name including extension (e.g., "report.pdf", "data.csv").'),
        content_type: z
          .string()
          .describe(
            'The MIME content type (e.g., "application/pdf", "text/csv", ' +
              '"image/png", "application/json").'
          ),
        content_base64: z
          .string()
          .describe(
            "The file content encoded as a base64 string. For text files, " +
              "encode the text content to base64 before passing."
          ),
      },
    },
    async ({ instance, table, record_sys_id, file_name, content_type, content_base64 }) => {
      try {
        const data = Buffer.from(content_base64, "base64");

        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const mgr = new AttachmentManager(snInstance);
            return await mgr.uploadAttachment({
              tableName: table,
              recordSysId: record_sys_id,
              fileName: file_name,
              contentType: content_type,
              data,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Attachment Uploaded ===");
        lines.push(`File Name: ${result.file_name || file_name}`);
        lines.push(`sys_id: ${result.sys_id}`);
        lines.push(`Table: ${table}`);
        lines.push(`Record: ${record_sys_id}`);
        if (result.content_type) lines.push(`Content Type: ${result.content_type}`);
        if (result.size_bytes) lines.push(`Size: ${result.size_bytes} bytes`);

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
              text: `Error uploading attachment: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

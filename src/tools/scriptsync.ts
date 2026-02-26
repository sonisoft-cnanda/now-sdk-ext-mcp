import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScriptSync } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the pull_script tool on the MCP server.
 *
 * Pulls a script from ServiceNow and saves it to a local file.
 */
export function registerPullScriptTool(server: McpServer): void {
  server.registerTool(
    "pull_script",
    {
      title: "Pull Script from ServiceNow",
      description:
        "Pull a script (Script Include, Business Rule, UI Script, UI Action, " +
        "Client Script) from a ServiceNow instance and save it to a local file. " +
        "The script content is read from the appropriate table and written to the " +
        "specified file path.\n\n" +
        "Supported script types:\n" +
        "- sys_script_include (Script Include)\n" +
        "- sys_script (Business Rule)\n" +
        "- sys_ui_script (UI Script)\n" +
        "- sys_ui_action (UI Action)\n" +
        "- sys_script_client (Client Script)",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        script_name: z
          .string()
          .describe(
            "The name of the script record on the instance " +
              '(e.g., "MyScriptInclude").'
          ),
        script_type: z
          .enum([
            "sys_script_include",
            "sys_script",
            "sys_ui_script",
            "sys_ui_action",
            "sys_script_client",
          ])
          .describe("The type of script to pull."),
        file_path: z
          .string()
          .describe("Local file path to write the script content to."),
      },
    },
    async ({ instance, script_name, script_type, file_path }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const sync = new ScriptSync(snInstance);
            return await sync.pullScript({
              scriptName: script_name,
              scriptType: script_type,
              filePath: file_path,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Pull Script Result ===");
        lines.push(`Success: ${result.success}`);
        lines.push(`Script: ${result.scriptName}`);
        lines.push(`Type: ${result.scriptType}`);
        if (result.sysId) lines.push(`sys_id: ${result.sysId}`);
        lines.push(`File: ${result.filePath}`);
        lines.push(`Message: ${result.message}`);
        if (result.error) lines.push(`Error: ${result.error}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error pulling script: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the push_script tool on the MCP server.
 *
 * Pushes a local script file to ServiceNow.
 */
export function registerPushScriptTool(server: McpServer): void {
  server.registerTool(
    "push_script",
    {
      title: "Push Script to ServiceNow",
      description:
        "Push a local script file to a ServiceNow instance, updating the script " +
        "field on the matching record. The file is read from the specified path " +
        "and the record is found by name in the appropriate table.\n\n" +
        "IMPORTANT: This modifies code on the ServiceNow instance. The record " +
        "must already exist — this updates an existing script, it does not create new ones.\n\n" +
        "Supported script types:\n" +
        "- sys_script_include (Script Include)\n" +
        "- sys_script (Business Rule)\n" +
        "- sys_ui_script (UI Script)\n" +
        "- sys_ui_action (UI Action)\n" +
        "- sys_script_client (Client Script)",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        script_name: z
          .string()
          .describe(
            "The name of the script record to update on the instance."
          ),
        script_type: z
          .enum([
            "sys_script_include",
            "sys_script",
            "sys_ui_script",
            "sys_ui_action",
            "sys_script_client",
          ])
          .describe("The type of script to push."),
        file_path: z
          .string()
          .describe("Local file path to read the script content from."),
      },
    },
    async ({ instance, script_name, script_type, file_path }) => {
      try {
        const result = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const sync = new ScriptSync(snInstance);
            return await sync.pushScript({
              scriptName: script_name,
              scriptType: script_type,
              filePath: file_path,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Push Script Result ===");
        lines.push(`Success: ${result.success}`);
        lines.push(`Script: ${result.scriptName}`);
        lines.push(`Type: ${result.scriptType}`);
        if (result.sysId) lines.push(`sys_id: ${result.sysId}`);
        lines.push(`Message: ${result.message}`);
        if (result.error) lines.push(`Error: ${result.error}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: !result.success,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error pushing script: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

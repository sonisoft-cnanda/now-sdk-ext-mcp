import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BackgroundScriptExecutor } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the execute_script tool on the MCP server.
 *
 * This tool executes JavaScript on a ServiceNow instance via Scripts - Background
 * (the /sys.scripts.do endpoint). It mirrors the behavior of the CLI's `exec` command.
 */
export function registerExecuteScriptTool(server: McpServer): void {
  server.registerTool(
    "execute_script",
    {
      title: "Execute Background Script",
      description:
        "Execute JavaScript on a ServiceNow instance using Scripts - Background. " +
        "The script runs server-side with full GlideSystem API access (gs, GlideRecord, " +
        "GlideAggregate, etc.). Use gs.print() to produce output. " +
        "Scripts execute with the permissions of the authenticated user.\n\n" +
        "IMPORTANT: This executes code directly on the ServiceNow instance. " +
        "Always review scripts before execution and prefer read-only operations " +
        "unless modification is explicitly intended.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to execute the script on. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        script: z
          .string()
          .describe(
            "The JavaScript code to execute on the ServiceNow instance. " +
            "Use gs.print() to output results. The script runs in the server-side " +
            "GlideSystem context with access to GlideRecord, GlideAggregate, " +
            "gs.getUser(), gs.now(), and all standard ServiceNow server-side APIs."
          ),
        scope: z
          .string()
          .default("global")
          .describe(
            'The application scope to execute the script in. Use "global" for ' +
            "global scope, or specify an application scope (e.g., " +
            '"x_myapp_custom") to run within that application\'s context.'
          ),
        params: z
          .record(z.string())
          .optional()
          .describe(
            "Optional key-value pairs for parameter substitution. " +
            "Occurrences of {paramName} in the script will be replaced with " +
            "the corresponding value. Example: { \"table\": \"incident\", " +
            '"field": "priority" } replaces {table} and {field} in the script.'
          ),
      },
    },
    async ({ instance, script, scope, params }) => {
      try {
        // Apply parameter substitutions if provided
        let processedScript = script;
        if (params && Object.keys(params).length > 0) {
          for (const [key, value] of Object.entries(params)) {
            const placeholder = `{${key}}`;
            processedScript = processedScript.split(placeholder).join(value);
          }
        }

        const result = await withConnectionRetry(instance, async (snInstance) => {
          const executor = new BackgroundScriptExecutor(snInstance, scope);
          return await executor.executeScript(processedScript, scope, snInstance);
        });

        if (!result || !result.scriptResults) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Script executed but returned no output. If you expected output, make sure your script uses gs.print() or gs.info().",
              },
            ],
          };
        }

        // Build structured output
        const scriptLines = result.scriptResults
          .filter((line) => line.line && line.line.trim().length > 0)
          .map((line) => line.line);

        const output = scriptLines.join("\n");

        // Include affected records info if present
        let fullOutput = output;
        if (result.affectedRecords) {
          fullOutput += `\n\n[Affected Records: ${result.affectedRecords}]`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: fullOutput || "(Script produced no output)",
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
              text: `Error executing script: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

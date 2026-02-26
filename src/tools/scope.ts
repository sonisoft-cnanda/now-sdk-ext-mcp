import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScopeManager } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the get_current_scope tool on the MCP server.
 *
 * This tool retrieves the currently active application scope on the ServiceNow
 * instance. It mirrors the behavior of the CLI's `scope get` command.
 */
export function registerGetCurrentScopeTool(server: McpServer): void {
  server.registerTool(
    "get_current_scope",
    {
      title: "Get Current Application Scope",
      description:
        "Get the currently active application scope on the ServiceNow instance.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
      },
    },
    async ({ instance }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const scopeManager = new ScopeManager(snInstance);
          return await scopeManager.getCurrentApplication();
        });

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No current application scope found.",
              },
            ],
          };
        }

        const lines: string[] = [
          "=== Current Application Scope ===",
          `Name:    ${result.name}`,
          `Sys ID:  ${result.sys_id}`,
          `Scope:   ${result.scope || "(unknown)"}`,
          `Version: ${result.version || "(unknown)"}`,
          `Active:  ${result.active || "(unknown)"}`,
        ];

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
              text: `Error getting current scope: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the set_current_scope tool on the MCP server.
 *
 * This tool changes the active application scope on the ServiceNow instance.
 * It validates the app exists, records the previous scope, performs the change,
 * and verifies the result. It mirrors the behavior of the CLI's `scope set` command.
 */
export function registerSetCurrentScopeTool(server: McpServer): void {
  server.registerTool(
    "set_current_scope",
    {
      title: "Set Current Application Scope",
      description:
        "Change the active application scope. Validates the app exists, records " +
        "previous scope, verifies the change. IMPORTANT: This changes the session's " +
        "application context.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        app_sys_id: z
          .string()
          .describe(
            "The sys_id of the application to set as the current scope. " +
            "Must be a 32-character hexadecimal string (e.g., " +
            '"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6").'
          ),
      },
    },
    async ({ instance, app_sys_id }) => {
      try {
        const result = await withConnectionRetry(instance, async (snInstance) => {
          const scopeManager = new ScopeManager(snInstance);
          return await scopeManager.setCurrentApplication(app_sys_id);
        });

        const lines: string[] = [
          "=== Set Application Scope ===",
          `Success:     ${result.success}`,
          `Application: ${result.application}`,
          `Scope:       ${result.scope || "(unknown)"}`,
          `Sys ID:      ${result.sysId}`,
          `Verified:    ${result.verified}`,
        ];

        if (result.previousScope) {
          lines.push(
            "",
            "--- Previous Scope ---",
            `Name:   ${result.previousScope.name || "(unknown)"}`,
            `Sys ID: ${result.previousScope.sys_id || "(unknown)"}`
          );
        }

        if (result.warnings.length > 0) {
          lines.push("", "--- Warnings ---");
          for (const warning of result.warnings) {
            lines.push(`  - ${warning}`);
          }
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
              text: `Error setting current scope: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_scoped_apps tool on the MCP server.
 *
 * This tool lists scoped applications (sys_app records) on the ServiceNow
 * instance with optional filtering. It mirrors the behavior of the CLI's
 * `scope list` command.
 */
export function registerListScopedAppsTool(server: McpServer): void {
  server.registerTool(
    "list_scoped_apps",
    {
      title: "List Scoped Applications",
      description:
        "List scoped applications (sys_app records) on the instance with optional filtering.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias to connect to. " +
            "This is the alias configured via `snc configure` (e.g., " +
            '"dev224436", "prod", "test"). The user will typically refer to ' +
            "this by name when saying things like \"on my dev224436 instance\". " +
            "If not provided, falls back to the SN_AUTH_ALIAS environment variable."
          ),
        query: z
          .string()
          .optional()
          .describe(
            "An encoded query string to filter applications. Uses ServiceNow " +
            "encoded query syntax (e.g., \"active=true^scopeSTARTSWITHx_\", " +
            "\"nameLIKEhr\"). If omitted, all applications are returned."
          ),
        limit: z
          .number()
          .min(1)
          .max(200)
          .default(50)
          .describe(
            "Maximum number of applications to return. Defaults to 50, " +
            "minimum 1, maximum 200."
          ),
      },
    },
    async ({ instance, query, limit }) => {
      try {
        const apps = await withConnectionRetry(instance, async (snInstance) => {
          const scopeManager = new ScopeManager(snInstance);
          return await scopeManager.listApplications({ encodedQuery: query, limit });
        });

        if (!apps || apps.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No scoped applications found matching the criteria.",
              },
            ],
          };
        }

        const lines: string[] = [
          `=== Scoped Applications (${apps.length} found) ===`,
          "",
        ];

        for (let i = 0; i < apps.length; i++) {
          const app = apps[i];
          lines.push(
            `${i + 1}. ${app.name}`,
            `   Sys ID:  ${app.sys_id}`,
            `   Scope:   ${app.scope || "(unknown)"}`,
            `   Version: ${app.version || "(unknown)"}`,
            `   Active:  ${app.active || "(unknown)"}`,
            ""
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
              text: `Error listing scoped applications: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

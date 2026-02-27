import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InstanceDiscovery } from "@sonisoft/now-sdk-ext-core";
import { withConnectionRetry } from "../common/connection.js";

/**
 * Registers the list_instance_tables tool on the MCP server.
 *
 * Lists tables on a ServiceNow instance with optional filtering by name prefix,
 * scope, and extendability. Complements lookup_table which searches by name/label.
 */
export function registerListInstanceTablesTool(server: McpServer): void {
  server.registerTool(
    "list_instance_tables",
    {
      title: "List Instance Tables",
      description:
        "List tables on a ServiceNow instance with optional filtering. Returns table name, " +
        "label, parent class, scope, and whether the table is extendable.\n\n" +
        "Unlike lookup_table (which searches by name or label keyword), this tool supports " +
        "browsing with prefix filters, scope filters, and extendable-only mode. " +
        "Use this to discover tables in a specific scope or browse tables by naming convention.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        name_prefix: z
          .string()
          .optional()
          .describe(
            'Filter tables whose name starts with this prefix (e.g., "cmdb_ci", ' +
              '"x_myapp", "incident"). Case-sensitive.'
          ),
        scope: z
          .string()
          .optional()
          .describe(
            'Filter tables belonging to a specific application scope (e.g., "global", ' +
              '"x_myapp_custom").'
          ),
        extendable_only: z
          .boolean()
          .optional()
          .describe("When true, only return tables that can be extended."),
        query: z
          .string()
          .optional()
          .describe(
            "An encoded query string for advanced filtering on sys_db_object."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum number of tables to return. Default is 50."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Offset for pagination (skip this many records)."),
      },
    },
    async ({ instance, name_prefix, scope, extendable_only, query, limit, offset }) => {
      try {
        const tables = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const discovery = new InstanceDiscovery(snInstance);
            return await discovery.listTables({
              namePrefix: name_prefix,
              scope,
              extendableOnly: extendable_only,
              query,
              limit,
              offset,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Instance Tables ===");
        if (name_prefix) lines.push(`Name Prefix: ${name_prefix}`);
        if (scope) lines.push(`Scope: ${scope}`);
        if (extendable_only) lines.push("Extendable Only: true");
        lines.push(`Tables returned: ${tables.length}`);

        if (tables.length === 0) {
          lines.push("");
          lines.push("No tables found matching the criteria.");
        } else {
          for (const table of tables) {
            lines.push("");
            lines.push(
              `  ${table.name || "unknown"} — ${table.label || "no label"}`
            );
            if (table.super_class)
              lines.push(`    Extends: ${table.super_class}`);
            if (table.sys_scope)
              lines.push(`    Scope: ${table.sys_scope}`);
            if (table.is_extendable)
              lines.push(`    Extendable: ${table.is_extendable}`);
          }
        }

        lines.push("");
        lines.push(`=== ${tables.length} table(s) returned ===`);

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
              text: `Error listing tables: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Registers the list_plugins tool on the MCP server.
 *
 * Lists platform plugins on a ServiceNow instance.
 */
export function registerListPluginsTool(server: McpServer): void {
  server.registerTool(
    "list_plugins",
    {
      title: "List Plugins",
      description:
        "List ServiceNow platform plugins on an instance. Returns plugin ID, name, " +
        "version, and active status. Use to discover which plugins are installed/active " +
        "or to find a specific plugin by name prefix.",
      inputSchema: {
        instance: z
          .string()
          .optional()
          .describe(
            "The ServiceNow instance auth alias (e.g., " +
              '"dev224436", "prod"). If not provided, falls back ' +
              "to the SN_AUTH_ALIAS environment variable."
          ),
        name_prefix: z
          .string()
          .optional()
          .describe(
            'Filter plugins whose name starts with this prefix (e.g., "com.snc", ' +
              '"com.glide"). Case-sensitive.'
          ),
        active_only: z
          .boolean()
          .default(true)
          .describe("When true (default), only return active plugins."),
        query: z
          .string()
          .optional()
          .describe("An encoded query string for advanced filtering on sys_plugins."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum number of plugins to return. Default is 50."),
      },
    },
    async ({ instance, name_prefix, active_only, query, limit }) => {
      try {
        const plugins = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const discovery = new InstanceDiscovery(snInstance);
            return await discovery.listPlugins({
              namePrefix: name_prefix,
              activeOnly: active_only,
              query,
              limit,
            });
          }
        );

        const lines: string[] = [];
        lines.push("=== Plugins ===");
        if (name_prefix) lines.push(`Name Prefix: ${name_prefix}`);
        lines.push(`Active Only: ${active_only}`);
        lines.push(`Plugins returned: ${plugins.length}`);

        if (plugins.length === 0) {
          lines.push("");
          lines.push("No plugins found matching the criteria.");
        } else {
          for (const plugin of plugins) {
            lines.push("");
            lines.push(
              `  ${plugin.id || plugin.sys_id} — ${plugin.name || "unnamed"}`
            );
            if (plugin.version) lines.push(`    Version: ${plugin.version}`);
            lines.push(`    Active: ${plugin.active ?? "unknown"}`);
          }
        }

        lines.push("");
        lines.push(`=== ${plugins.length} plugin(s) returned ===`);

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
              text: `Error listing plugins: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

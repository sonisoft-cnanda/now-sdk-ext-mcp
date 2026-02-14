import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TableAPIRequest } from "@sonisoft/now-sdk-ext-core";
import {
  withConnectionRetry,
  isRetryableResponse,
} from "../common/connection.js";

interface SysScopeRecord {
  sys_id: string;
  name: string;
  scope: string;
  version: string;
  vendor: string;
  active: string;
  short_description: string;
  sys_class_name: string;
}

interface SysScopeResponse {
  result: SysScopeRecord[];
}

interface SysPluginRecord {
  sys_id: string;
  name: string;
  id: string;
  version: string;
  active: string;
}

interface SysPluginResponse {
  result: SysPluginRecord[];
}

/**
 * Maps sys_class_name values from the sys_scope hierarchy to
 * human-readable labels for the output.
 */
function classNameToLabel(sysClassName: string): string {
  switch (sysClassName) {
    case "sys_app":
      return "Custom App";
    case "sys_store_app":
      return "Store App";
    default:
      return "Application";
  }
}

/**
 * Registers the lookup_app tool on the MCP server.
 *
 * Searches ServiceNow for applications (scoped apps) and platform plugins
 * by name, scope namespace, or plugin ID. Queries sys_scope (which covers
 * both sys_app and sys_store_app via table inheritance) and sys_plugins
 * in parallel.
 */
export function registerLookupAppTool(server: McpServer): void {
  server.registerTool(
    "lookup_app",
    {
      title: "Lookup Application or Plugin",
      description:
        "Search for ServiceNow applications (scoped apps) and platform plugins by name, " +
        "scope namespace, or plugin ID. Returns sys_id, name, scope, version, active status, " +
        "and type for each match.\n\n" +
        "ServiceNow uses a hierarchical table structure for packages:\n" +
        "- sys_scope: All scoped applications (base table)\n" +
        "  - sys_app: Custom applications in development on this instance\n" +
        "  - sys_store_app: Applications installed from the ServiceNow Store or company app repo\n" +
        "- sys_plugins: Platform plugins\n\n" +
        "Key use cases:\n" +
        "- Find an application's sys_id to pass as the `scope` parameter to execute_script " +
        "(to run scripts within that application's scope)\n" +
        "- Check whether a specific app or plugin is installed/active on the instance\n" +
        "- Look up version, scope namespace, and vendor info for any application or plugin",
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
            "Name, scope namespace (e.g., \"x_acme_my_app\", \"sn_vul\"), or plugin ID " +
              "(e.g., \"com.snc.vulnerability_response\") to search for. " +
              "Case-insensitive partial matching (contains)."
          ),
        type: z
          .enum(["all", "app", "plugin"])
          .default("all")
          .describe(
            'Filter search scope. "app" searches scoped applications only (sys_scope table ' +
              "which includes both custom apps and store apps), " +
              '"plugin" searches platform plugins only (sys_plugins table), ' +
              '"all" searches both. Default is "all".'
          ),
        active_only: z
          .boolean()
          .default(false)
          .describe(
            "When true, only returns active/installed applications and plugins. " +
              "Default is false (returns all matches regardless of active status)."
          ),
      },
    },
    async ({ instance, search_term, type, active_only }) => {
      try {
        const results = await withConnectionRetry(
          instance,
          async (snInstance) => {
            const tableApi = new TableAPIRequest(snInstance);

            // Build sys_scope query with ^NQ for OR grouping across
            // name, scope namespace, and short_description.
            const buildScopeQuery = (): string => {
              const prefix = active_only ? "active=true^" : "";
              const parts = [
                `${prefix}nameLIKE${search_term}`,
                `${prefix}scopeLIKE${search_term}`,
                `${prefix}short_descriptionLIKE${search_term}`,
              ];
              return parts.join("^NQ") + "^ORDERBYname";
            };

            // Build sys_plugins query with ^NQ for OR grouping across
            // name and plugin id.
            const buildPluginQuery = (): string => {
              const prefix = active_only ? "active=true^" : "";
              const parts = [
                `${prefix}nameLIKE${search_term}`,
                `${prefix}idLIKE${search_term}`,
              ];
              return parts.join("^NQ") + "^ORDERBYname";
            };

            // Execute queries in parallel, skipping based on type filter
            const scopePromise =
              type === "plugin"
                ? Promise.resolve(null)
                : tableApi.get<SysScopeResponse>("sys_scope", {
                    sysparm_query: buildScopeQuery(),
                    sysparm_fields:
                      "sys_id,name,scope,version,vendor,active,short_description,sys_class_name",
                    sysparm_limit: 25,
                    sysparm_display_value: "false",
                  });

            const pluginPromise =
              type === "app"
                ? Promise.resolve(null)
                : tableApi.get<SysPluginResponse>("sys_plugins", {
                    sysparm_query: buildPluginQuery(),
                    sysparm_fields: "sys_id,name,id,version,active",
                    sysparm_limit: 25,
                    sysparm_display_value: "false",
                  });

            const [scopeResp, pluginResp] = await Promise.all([
              scopePromise,
              pluginPromise,
            ]);

            // Check for retryable responses (stale session, no response)
            if (scopeResp && isRetryableResponse(scopeResp)) {
              const status = scopeResp?.status ?? "unknown";
              throw new Error(`HTTP ${status} querying sys_scope`);
            }
            if (pluginResp && isRetryableResponse(pluginResp)) {
              const status = pluginResp?.status ?? "unknown";
              throw new Error(`HTTP ${status} querying sys_plugins`);
            }

            return { scopeResp, pluginResp };
          }
        );

        const { scopeResp, pluginResp } = results;

        // Check for non-retryable HTTP errors
        if (scopeResp && scopeResp.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying applications: HTTP ${scopeResp.status} ${scopeResp.statusText}`,
              },
            ],
            isError: true,
          };
        }
        if (pluginResp && pluginResp.status !== 200) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error querying plugins: HTTP ${pluginResp.status} ${pluginResp.statusText}`,
              },
            ],
            isError: true,
          };
        }

        const apps = scopeResp?.bodyObject?.result ?? [];
        const plugins = pluginResp?.bodyObject?.result ?? [];
        const totalFound = apps.length + plugins.length;

        // Format output
        const lines: string[] = [];

        lines.push("=== Application & Plugin Search Results ===");
        const searchInfo: string[] = [`Search: "${search_term}"`];
        searchInfo.push(`Type: ${type}`);
        if (active_only) searchInfo.push("Active only: yes");
        lines.push(searchInfo.join(" | "));
        lines.push(`Found: ${totalFound} result(s)`);

        // Applications section
        if (type !== "plugin") {
          lines.push("");
          lines.push(`--- Applications (${apps.length}) ---`);
          if (apps.length === 0) {
            lines.push("No matching applications found.");
          } else {
            apps.forEach((app, index) => {
              const appType = classNameToLabel(app.sys_class_name);
              lines.push("");
              lines.push(`${index + 1}. ${app.name}`);
              lines.push(`   sys_id: ${app.sys_id}`);
              lines.push(`   Scope: ${app.scope}`);
              lines.push(`   Version: ${app.version || "N/A"}`);
              lines.push(`   Type: ${appType}`);
              lines.push(`   Active: ${app.active}`);
              if (app.vendor) lines.push(`   Vendor: ${app.vendor}`);
              if (app.short_description) {
                const truncated =
                  app.short_description.length > 120
                    ? app.short_description.substring(0, 120) + "..."
                    : app.short_description;
                lines.push(`   Description: ${truncated}`);
              }
            });
          }
        }

        // Plugins section
        if (type !== "app") {
          lines.push("");
          lines.push(`--- Plugins (${plugins.length}) ---`);
          if (plugins.length === 0) {
            lines.push("No matching plugins found.");
          } else {
            plugins.forEach((plugin, index) => {
              lines.push("");
              lines.push(`${index + 1}. ${plugin.name}`);
              lines.push(`   sys_id: ${plugin.sys_id}`);
              lines.push(`   Plugin ID: ${plugin.id}`);
              lines.push(`   Version: ${plugin.version || "N/A"}`);
              lines.push(`   Active: ${plugin.active}`);
            });
          }
        }

        // Footer
        lines.push("");
        lines.push(`=== ${totalFound} result(s) found ===`);

        if (apps.length > 0) {
          lines.push("");
          lines.push(
            "Tip: Use an application's sys_id as the `scope` parameter in execute_script " +
              "to run scripts within that application's scope."
          );
        }

        if (totalFound === 0) {
          lines.push("");
          lines.push(
            "No applications or plugins matched your search. " +
              "Try a shorter or different search term."
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
              text: `Error looking up applications: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
